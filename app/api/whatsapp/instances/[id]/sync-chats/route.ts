import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import * as zapi from '@/lib/zapi/client';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/whatsapp/instances/[id]/sync-chats
 *
 * Fetches existing chats from Z-API and imports them as conversations
 * with their message history. Useful when the webhook missed messages
 * or when the instance was connected before webhooks were configured.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  // Get the instance
  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .single();

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }

  const creds: zapi.ZApiCredentials = {
    instanceId: instance.instance_id,
    token: instance.instance_token,
    clientToken: instance.client_token ?? undefined,
  };

  try {
    // Fetch chats from Z-API
    const chats = await zapi.getChats(creds);
    if (!chats || !Array.isArray(chats)) {
      return NextResponse.json({ data: { synced: 0, messages: 0 }, message: 'Nenhum chat encontrado na Z-API.' });
    }

    // Use admin client for writing (bypass RLS)
    const adminSupabase = createStaticAdminClient();
    let synced = 0;
    let totalMessages = 0;

    for (const chat of chats) {
      // Skip groups for now
      if (chat.isGroup) continue;
      // Skip if no phone
      if (!chat.phone) continue;

      // Clean phone number (remove @c.us suffix if present)
      const phone = chat.phone.replace(/@.*$/, '');

      // Check if conversation already exists
      const { data: existing } = await adminSupabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('instance_id', instance.id)
        .eq('phone', phone)
        .single();

      if (existing) {
        // Even for existing conversations, sync messages that might be missing
        const msgCount = await syncMessagesForConversation(
          adminSupabase, creds, existing.id, profile.organization_id, phone,
        );
        totalMessages += msgCount;
        if (msgCount > 0) synced++; // Count as synced if new messages were imported
        continue;
      }

      // Create the conversation
      const { data: newConv, error: insertError } = await adminSupabase
        .from('whatsapp_conversations')
        .insert({
          instance_id: instance.id,
          organization_id: profile.organization_id,
          phone,
          contact_name: chat.name || undefined,
          is_group: false,
          unread_count: chat.unreadMessages || 0,
          last_message_at: chat.lastMessageTimestamp
            ? new Date(chat.lastMessageTimestamp * 1000).toISOString()
            : new Date().toISOString(),
        })
        .select('id')
        .single();

      if (insertError || !newConv) {
        console.error('[sync-chats] Error inserting conversation for phone:', phone, insertError?.message);
        continue;
      }

      // Fetch and import messages for this conversation
      const msgCount = await syncMessagesForConversation(
        adminSupabase, creds, newConv.id, profile.organization_id, phone,
      );
      totalMessages += msgCount;
      synced++;
    }

    return NextResponse.json({
      data: { synced, total: chats.length, messages: totalMessages },
      message: synced > 0
        ? `${synced} conversa(s) sincronizada(s) com ${totalMessages} mensagem(ns)!`
        : 'Todas as conversas já estão sincronizadas.',
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

/** Fetch messages from Z-API for a chat and import them into the DB. */
async function syncMessagesForConversation(
  supabase: ReturnType<typeof createStaticAdminClient>,
  creds: zapi.ZApiCredentials,
  conversationId: string,
  organizationId: string,
  phone: string,
): Promise<number> {
  let messages: zapi.ZApiChatMessage[];
  try {
    messages = await zapi.getChatMessages(creds, phone);
  } catch (err) {
    console.error('[sync-chats] Error fetching messages for phone:', phone, err);
    return 0;
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) return 0;

  // Get existing message IDs to avoid duplicates
  const { data: existingMsgs } = await supabase
    .from('whatsapp_messages')
    .select('zapi_message_id')
    .eq('conversation_id', conversationId)
    .not('zapi_message_id', 'is', null);

  const existingIds = new Set((existingMsgs ?? []).map((m) => m.zapi_message_id));

  // Filter out already-imported messages
  const newMessages = messages.filter((m) => m.messageId && !existingIds.has(m.messageId));
  if (newMessages.length === 0) return 0;

  // Sort by timestamp ascending
  newMessages.sort((a, b) => (a.momment || 0) - (b.momment || 0));

  // Build insert rows
  const rows = newMessages.map((m) => {
    const { messageType, textBody, mediaUrl, mediaMimeType, mediaFilename, mediaCaption, latitude, longitude } = extractZApiMessageContent(m);
    return {
      conversation_id: conversationId,
      organization_id: organizationId,
      zapi_message_id: m.messageId,
      from_me: m.fromMe ?? false,
      sender_name: m.senderName || m.chatName || undefined,
      message_type: messageType,
      text_body: textBody,
      media_url: mediaUrl,
      media_mime_type: mediaMimeType,
      media_filename: mediaFilename,
      media_caption: mediaCaption,
      latitude,
      longitude,
      status: m.fromMe ? 'sent' : 'received',
      whatsapp_timestamp: m.momment ? new Date(m.momment).toISOString() : new Date().toISOString(),
    };
  });

  // Batch insert (Supabase supports bulk insert)
  const { error: batchError } = await supabase
    .from('whatsapp_messages')
    .insert(rows);

  if (batchError) {
    console.error('[sync-chats] Error batch inserting messages for conversation:', conversationId, batchError.message);
    return 0;
  }

  // Update conversation with last message info
  const lastMsg = rows[rows.length - 1];
  const previewText = lastMsg.text_body || lastMsg.media_caption || (lastMsg.message_type !== 'text' ? `[${lastMsg.message_type}]` : '');
  await supabase
    .from('whatsapp_conversations')
    .update({
      last_message_text: previewText.slice(0, 255),
      last_message_at: lastMsg.whatsapp_timestamp,
      last_message_from_me: lastMsg.from_me,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  return rows.length;
}

/** Extract content from a Z-API chat message (similar to webhook's extractMessageContent). */
function extractZApiMessageContent(msg: zapi.ZApiChatMessage): {
  messageType: string;
  textBody?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaFilename?: string;
  mediaCaption?: string;
  latitude?: number;
  longitude?: number;
} {
  if (msg.text?.message) {
    return { messageType: 'text', textBody: msg.text.message };
  }
  if (msg.image) {
    return { messageType: 'image', mediaUrl: msg.image.imageUrl, mediaMimeType: msg.image.mimeType, mediaCaption: msg.image.caption };
  }
  if (msg.video) {
    return { messageType: 'video', mediaUrl: msg.video.videoUrl, mediaMimeType: msg.video.mimeType, mediaCaption: msg.video.caption };
  }
  if (msg.audio) {
    return { messageType: 'audio', mediaUrl: msg.audio.audioUrl, mediaMimeType: msg.audio.mimeType };
  }
  if (msg.document) {
    return { messageType: 'document', mediaUrl: msg.document.documentUrl, mediaMimeType: msg.document.mimeType, mediaFilename: msg.document.fileName || msg.document.title };
  }
  if (msg.sticker) {
    return { messageType: 'sticker', mediaUrl: msg.sticker.stickerUrl, mediaMimeType: msg.sticker.mimeType };
  }
  if (msg.location) {
    return { messageType: 'location', latitude: msg.location.latitude, longitude: msg.location.longitude };
  }
  if (msg.reaction) {
    return { messageType: 'reaction', textBody: msg.reaction.value };
  }
  return { messageType: 'text', textBody: '[Mensagem não suportada]' };
}
