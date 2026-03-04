import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getEvolutionCredentials } from '@/lib/evolution/helpers';
import * as evolution from '@/lib/evolution/client';

type Params = { params: Promise<{ id: string }> };

// TEMPORARY: fallback org ID when auth is bypassed
const FALLBACK_ORG_ID = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';

// Max conversations to sync messages for per request (avoid Vercel timeout)
const MESSAGES_BATCH_SIZE = 15;

/**
 * POST /api/whatsapp/instances/[id]/sync-chats
 *
 * Fetches existing chats from Evolution API and imports them as conversations
 * with their message history.
 *
 * Query params:
 *   ?mode=conversations  — Only create conversations, skip messages (fast)
 *   ?mode=messages        — Sync messages for conversations that don't have any yet
 *   (default)             — Create conversations + sync messages in batches
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();
  let orgId: string;

  if (!user) {
    orgId = FALLBACK_ORG_ID;
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    orgId = profile.organization_id;
  }

  // Get the instance
  const { data: instance } = await queryClient
    .from('whatsapp_instances')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
    .single();

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }

  const creds = await getEvolutionCredentials(queryClient, instance);
  const url = new URL(_request.url);
  const mode = url.searchParams.get('mode') || 'all';

  try {
    const adminSupabase = createStaticAdminClient();

    // ── MODE: messages ─────────────────────────────────────────────────
    // Sync messages for conversations that have 0 messages (in batches)
    if (mode === 'messages') {
      // Find conversations without messages
      const { data: emptyConvs } = await adminSupabase
        .from('whatsapp_conversations')
        .select('id, phone')
        .eq('instance_id', instance.id)
        .eq('organization_id', orgId)
        .is('last_message_text', null)
        .limit(MESSAGES_BATCH_SIZE);

      if (!emptyConvs || emptyConvs.length === 0) {
        return NextResponse.json({
          data: { synced: 0, messages: 0, remaining: 0 },
          message: 'Todas as mensagens já estão sincronizadas.',
        });
      }

      let totalMessages = 0;
      let synced = 0;

      for (const conv of emptyConvs) {
        const jid = `${conv.phone}@s.whatsapp.net`;
        const msgCount = await syncMessagesForConversation(
          adminSupabase, creds, conv.id, orgId, jid,
        );
        totalMessages += msgCount;
        if (msgCount > 0) synced++;
      }

      // Check how many remain
      const { count: remaining } = await adminSupabase
        .from('whatsapp_conversations')
        .select('id', { count: 'exact', head: true })
        .eq('instance_id', instance.id)
        .eq('organization_id', orgId)
        .is('last_message_text', null);

      return NextResponse.json({
        data: { synced, messages: totalMessages, remaining: remaining ?? 0 },
        message: synced > 0
          ? `${synced} conversa(s) com ${totalMessages} mensagem(ns) sincronizadas. ${remaining ?? 0} restante(s).`
          : 'Nenhuma mensagem nova encontrada neste lote.',
      });
    }

    // ── MODE: conversations / all ──────────────────────────────────────
    // Fetch chats from Evolution API and create conversations
    const chats = await evolution.findChats(creds);
    if (!chats || !Array.isArray(chats)) {
      return NextResponse.json({ data: { synced: 0, messages: 0 }, message: 'Nenhum chat encontrado na Evolution API.' });
    }

    let synced = 0;
    let totalMessages = 0;
    let skippedExisting = 0;

    // Batch: get all existing phone numbers for this instance
    const { data: existingConvs } = await adminSupabase
      .from('whatsapp_conversations')
      .select('id, phone')
      .eq('instance_id', instance.id)
      .eq('organization_id', orgId);

    const existingPhones = new Map(
      (existingConvs ?? []).map((c) => [c.phone, c.id]),
    );

    // Collect conversations to create
    const toCreate: Array<{
      phone: string;
      contactName?: string;
      jid: string;
    }> = [];

    for (const chat of chats) {
      const chatObj = chat as Record<string, unknown>;
      const jid = (chatObj.remoteJid as string) || (chatObj.id as string) || '';

      // Skip groups
      if (jid.endsWith('@g.us')) continue;
      if (!jid.endsWith('@s.whatsapp.net')) continue;

      const phone = jid.replace(/@s\.whatsapp\.net$/, '');
      if (!phone) continue;

      if (existingPhones.has(phone)) {
        skippedExisting++;
        continue;
      }

      const contactName = (chatObj.name as string) || (chatObj.pushName as string) || undefined;
      toCreate.push({ phone, contactName, jid });
    }

    // Bulk insert conversations (batches of 100)
    for (let i = 0; i < toCreate.length; i += 100) {
      const batch = toCreate.slice(i, i + 100);
      const rows = batch.map((c) => ({
        instance_id: instance.id,
        organization_id: orgId,
        phone: c.phone,
        contact_name: c.contactName,
        is_group: false,
        unread_count: 0,
        last_message_at: new Date().toISOString(),
      }));

      const { error: batchErr } = await adminSupabase
        .from('whatsapp_conversations')
        .insert(rows);

      if (batchErr) {
        console.error('[sync-chats] Batch insert error:', batchErr.message);
        // Try individual inserts for this batch
        for (const row of rows) {
          const { error: singleErr } = await adminSupabase
            .from('whatsapp_conversations')
            .insert(row);
          if (!singleErr) synced++;
          else console.error('[sync-chats] Single insert error:', row.phone, singleErr.message);
        }
      } else {
        synced += batch.length;
      }
    }

    // If mode is 'all', also sync messages for a small batch of new conversations
    if (mode === 'all' && synced > 0) {
      // Get the newly created conversations (first batch only)
      const { data: newConvs } = await adminSupabase
        .from('whatsapp_conversations')
        .select('id, phone')
        .eq('instance_id', instance.id)
        .eq('organization_id', orgId)
        .is('last_message_text', null)
        .limit(MESSAGES_BATCH_SIZE);

      if (newConvs) {
        for (const conv of newConvs) {
          const jid = `${conv.phone}@s.whatsapp.net`;
          const msgCount = await syncMessagesForConversation(
            adminSupabase, creds, conv.id, orgId, jid,
          );
          totalMessages += msgCount;
        }
      }
    }

    // Count remaining conversations without messages
    const { count: remaining } = await adminSupabase
      .from('whatsapp_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('instance_id', instance.id)
      .eq('organization_id', orgId)
      .is('last_message_text', null);

    return NextResponse.json({
      data: {
        synced,
        skippedExisting,
        total: chats.length,
        messages: totalMessages,
        remaining: remaining ?? 0,
      },
      message: synced > 0
        ? `${synced} conversa(s) criada(s) com ${totalMessages} mensagem(ns). ${remaining ?? 0} conversa(s) aguardando mensagens.`
        : `Todas as ${skippedExisting} conversas já estão sincronizadas. ${remaining ?? 0} aguardando mensagens.`,
    });
  } catch (err) {
    console.error('[sync-chats] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Falha ao sincronizar chats' },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fetch messages from Evolution API for a chat and import them into the DB. */
async function syncMessagesForConversation(
  supabase: ReturnType<typeof createStaticAdminClient>,
  creds: evolution.EvolutionCredentials,
  conversationId: string,
  organizationId: string,
  remoteJid: string,
): Promise<number> {
  let rawMessages: unknown[];
  try {
    rawMessages = await evolution.findMessages(creds, remoteJid);
  } catch (err) {
    console.error('[sync-chats] Error fetching messages for JID:', remoteJid, err);
    return 0;
  }

  if (!rawMessages || !Array.isArray(rawMessages) || rawMessages.length === 0) return 0;

  const messages = rawMessages as Array<Record<string, unknown>>;

  // Get existing message IDs to avoid duplicates
  const { data: existingMsgs } = await supabase
    .from('whatsapp_messages')
    .select('evolution_message_id')
    .eq('conversation_id', conversationId)
    .not('evolution_message_id', 'is', null);

  const existingIds = new Set((existingMsgs ?? []).map((m) => m.evolution_message_id));

  // Filter out already-imported messages and extract message IDs
  const newMessages = messages.filter((m) => {
    const key = m.key as Record<string, unknown> | undefined;
    const msgId = key?.id as string | undefined;
    return msgId && !existingIds.has(msgId);
  });

  if (newMessages.length === 0) return 0;

  // Sort by timestamp ascending
  newMessages.sort((a, b) => {
    const tsA = Number(a.messageTimestamp) || 0;
    const tsB = Number(b.messageTimestamp) || 0;
    return tsA - tsB;
  });

  // Limit to last 50 messages per conversation to avoid payload size issues
  const recentMessages = newMessages.slice(-50);

  // Build insert rows — also capture pushName for contact name
  let contactPushName: string | undefined;
  const rows = recentMessages.map((m) => {
    const key = m.key as Record<string, unknown> | undefined;
    const messageId = key?.id as string | undefined;
    const fromMe = (key?.fromMe as boolean) ?? false;
    const senderName = (m.pushName as string) || undefined;
    if (senderName && !fromMe) contactPushName = senderName;
    const rawTimestamp = Number(m.messageTimestamp) || 0;
    const timestampMs = rawTimestamp > 1e12 ? rawTimestamp : rawTimestamp * 1000;
    const whatsappTimestamp = rawTimestamp ? new Date(timestampMs).toISOString() : new Date().toISOString();

    const { messageType, textBody, mediaUrl, mediaMimeType, mediaFilename, mediaCaption, latitude, longitude } = extractEvolutionMessageContent(m);

    return {
      conversation_id: conversationId,
      organization_id: organizationId,
      evolution_message_id: messageId,
      from_me: fromMe,
      sender_name: senderName,
      message_type: messageType,
      text_body: textBody,
      media_url: mediaUrl,
      media_mime_type: mediaMimeType,
      media_filename: mediaFilename,
      media_caption: mediaCaption,
      latitude,
      longitude,
      status: fromMe ? 'sent' : 'received',
      whatsapp_timestamp: whatsappTimestamp,
    };
  });

  // Batch insert
  const { error: batchError } = await supabase
    .from('whatsapp_messages')
    .insert(rows);

  if (batchError) {
    console.error('[sync-chats] Error batch inserting messages for conversation:', conversationId, batchError.message);
    return 0;
  }

  // Update conversation with last message info + contact name
  const lastMsg = rows[rows.length - 1];
  const previewText = lastMsg.text_body || lastMsg.media_caption || (lastMsg.message_type !== 'text' ? `[${lastMsg.message_type}]` : '');
  const updateData: Record<string, unknown> = {
    last_message_text: previewText.slice(0, 255),
    last_message_at: lastMsg.whatsapp_timestamp,
    last_message_from_me: lastMsg.from_me,
    updated_at: new Date().toISOString(),
  };
  // Also update contact_name if we found a pushName from incoming messages
  if (contactPushName) {
    updateData.contact_name = contactPushName;
  }

  await supabase
    .from('whatsapp_conversations')
    .update(updateData)
    .eq('id', conversationId);

  return rows.length;
}

/**
 * Extract content from an Evolution API message object.
 */
function extractEvolutionMessageContent(msg: Record<string, unknown>): {
  messageType: string;
  textBody?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaFilename?: string;
  mediaCaption?: string;
  latitude?: number;
  longitude?: number;
} {
  const messageObj = msg.message as Record<string, unknown> | undefined;
  if (!messageObj) {
    return { messageType: 'text', textBody: '[Mensagem não suportada]' };
  }

  if (typeof messageObj.conversation === 'string') {
    return { messageType: 'text', textBody: messageObj.conversation };
  }

  const extendedText = messageObj.extendedTextMessage as Record<string, unknown> | undefined;
  if (extendedText?.text) {
    return { messageType: 'text', textBody: extendedText.text as string };
  }

  const imageMsg = messageObj.imageMessage as Record<string, unknown> | undefined;
  if (imageMsg) {
    return {
      messageType: 'image',
      mediaUrl: imageMsg.url as string | undefined,
      mediaMimeType: imageMsg.mimetype as string | undefined,
      mediaCaption: imageMsg.caption as string | undefined,
    };
  }

  const videoMsg = messageObj.videoMessage as Record<string, unknown> | undefined;
  if (videoMsg) {
    return {
      messageType: 'video',
      mediaUrl: videoMsg.url as string | undefined,
      mediaMimeType: videoMsg.mimetype as string | undefined,
      mediaCaption: videoMsg.caption as string | undefined,
    };
  }

  const audioMsg = messageObj.audioMessage as Record<string, unknown> | undefined;
  if (audioMsg) {
    return {
      messageType: 'audio',
      mediaUrl: audioMsg.url as string | undefined,
      mediaMimeType: audioMsg.mimetype as string | undefined,
    };
  }

  const documentMsg = messageObj.documentMessage as Record<string, unknown> | undefined;
  if (documentMsg) {
    return {
      messageType: 'document',
      mediaUrl: documentMsg.url as string | undefined,
      mediaMimeType: documentMsg.mimetype as string | undefined,
      mediaFilename: (documentMsg.fileName as string | undefined) || (documentMsg.title as string | undefined),
      mediaCaption: documentMsg.caption as string | undefined,
    };
  }

  const stickerMsg = messageObj.stickerMessage as Record<string, unknown> | undefined;
  if (stickerMsg) {
    return {
      messageType: 'sticker',
      mediaUrl: stickerMsg.url as string | undefined,
      mediaMimeType: stickerMsg.mimetype as string | undefined,
    };
  }

  const locationMsg = messageObj.locationMessage as Record<string, unknown> | undefined;
  if (locationMsg) {
    return {
      messageType: 'location',
      latitude: locationMsg.degreesLatitude as number | undefined,
      longitude: locationMsg.degreesLongitude as number | undefined,
    };
  }

  const reactionMsg = messageObj.reactionMessage as Record<string, unknown> | undefined;
  if (reactionMsg) {
    return { messageType: 'reaction', textBody: reactionMsg.text as string | undefined };
  }

  return { messageType: 'text', textBody: '[Mensagem não suportada]' };
}
