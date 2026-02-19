import { NextResponse } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import {
  getOrCreateConversation,
  insertMessage,
  updateMessageStatus,
  updateInstance,
} from '@/lib/supabase/whatsapp';
import * as zapi from '@/lib/zapi/client';
import type { ZApiIncomingMessage, ZApiMessageStatus, ZApiConnectionEvent } from '@/types/whatsapp';
import { processIncomingMessage } from '@/lib/zapi/aiAgent';

type Params = { params: Promise<{ instanceId: string }> };

/**
 * Z-API Webhook receiver.
 *
 * Routes:
 *   POST /api/whatsapp/webhook/{instanceId}/message-received
 *   POST /api/whatsapp/webhook/{instanceId}/message-status
 *   POST /api/whatsapp/webhook/{instanceId}/connection
 *
 * The instanceId in the URL is our internal UUID (whatsapp_instances.id).
 * Z-API is configured to POST to these endpoints.
 */
export async function POST(request: Request, { params }: Params) {
  const { instanceId } = await params;
  const url = new URL(request.url);
  const pathParts = url.pathname.split('/');
  // The path pattern is: /api/whatsapp/webhook/{instanceId}
  // But we also need the sub-path...
  // Actually since this is the catch-all for [instanceId], we need a different approach.
  // Z-API sends different payloads to different webhook URLs.
  // We'll detect the type from the payload itself.

  const supabase = createStaticAdminClient();

  // Get the instance from our DB
  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('id', instanceId)
    .single();

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  try {
    // Detect webhook type from payload
    if ('connected' in body || body.type === 'ConnectedCallback' || body.type === 'DisconnectedCallback') {
      await handleConnectionEvent(supabase, instance, body);
    } else if (body.status && !body.text && !body.image && !body.audio && !body.video && !body.document && !body.sticker && !body.location) {
      // Message status update (has status but no content fields)
      if (body.messageId && (body.status === 'SENT' || body.status === 'RECEIVED' || body.status === 'READ' || body.status === 'PLAYED' || body.status === 'DELETED')) {
        await handleMessageStatus(supabase, body as ZApiMessageStatus);
      }
    } else if (body.phone && (body.text || body.image || body.audio || body.video || body.document || body.sticker || body.location || body.reaction)) {
      await handleIncomingMessage(supabase, instance, body as ZApiIncomingMessage);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[whatsapp-webhook] Error:', err);
    return NextResponse.json({ ok: true }); // Return 200 to prevent Z-API retries
  }
}

// Also handle GET for webhook verification
export async function GET() {
  return NextResponse.json({ ok: true, service: 'fullhouse-crm-whatsapp-webhook' });
}

// ---------------------------------------------------------------------------
// Handler: Incoming message
// ---------------------------------------------------------------------------

async function handleIncomingMessage(
  supabase: ReturnType<typeof createStaticAdminClient>,
  instance: Record<string, unknown>,
  payload: ZApiIncomingMessage,
) {
  // Skip messages sent by ourselves
  if (payload.fromMe) return;
  // Skip group messages for now
  if (payload.isGroup) return;
  // Skip status reply messages
  if ('isStatusReply' in payload && (payload as Record<string, unknown>).isStatusReply) return;

  const organizationId = instance.organization_id as string;
  const instanceDbId = instance.id as string;

  // Get or create conversation
  const conversation = await getOrCreateConversation(
    supabase,
    organizationId,
    instanceDbId,
    payload.phone,
    payload.chatName || payload.senderName,
    payload.senderPhoto,
    false,
  );

  // Determine message type and content
  const { messageType, textBody, mediaUrl, mediaMimeType, mediaFilename, mediaCaption, latitude, longitude } = extractMessageContent(payload);

  // Persist message
  const message = await insertMessage(supabase, {
    conversation_id: conversation.id,
    organization_id: organizationId,
    zapi_message_id: payload.messageId,
    from_me: false,
    sender_name: payload.senderName || payload.chatName,
    message_type: messageType,
    text_body: textBody,
    media_url: mediaUrl,
    media_mime_type: mediaMimeType,
    media_filename: mediaFilename,
    media_caption: mediaCaption,
    latitude,
    longitude,
    status: 'received',
    whatsapp_timestamp: payload.momment ? new Date(payload.momment).toISOString() : new Date().toISOString(),
  } as Parameters<typeof insertMessage>[1]);

  // Check if AI agent should process this message
  const aiEnabled = instance.ai_enabled as boolean;
  if (aiEnabled && conversation.ai_active) {
    // Process in background (don't block the webhook response)
    processIncomingMessage({
      supabase,
      conversation,
      instance: {
        id: instanceDbId,
        instance_id: instance.instance_id as string,
        instance_token: instance.instance_token as string,
        client_token: (instance.client_token as string) ?? undefined,
        organization_id: organizationId,
      },
      incomingMessage: message,
    }).catch((err) => {
      console.error('[whatsapp-ai-agent] Error processing message:', err);
    });
  }
}

// ---------------------------------------------------------------------------
// Handler: Message status change
// ---------------------------------------------------------------------------

async function handleMessageStatus(
  supabase: ReturnType<typeof createStaticAdminClient>,
  payload: ZApiMessageStatus,
) {
  const statusMap: Record<string, string> = {
    SENT: 'sent',
    RECEIVED: 'received',
    READ: 'read',
    PLAYED: 'read',
    DELETED: 'deleted',
  };

  const newStatus = statusMap[payload.status];
  if (newStatus && payload.messageId) {
    await updateMessageStatus(supabase, payload.messageId, newStatus);
  }
}

// ---------------------------------------------------------------------------
// Handler: Connection event
// ---------------------------------------------------------------------------

async function handleConnectionEvent(
  supabase: ReturnType<typeof createStaticAdminClient>,
  instance: Record<string, unknown>,
  payload: ZApiConnectionEvent,
) {
  const isConnected = payload.connected ?? false;
  await updateInstance(supabase, instance.id as string, {
    status: isConnected ? 'connected' : 'disconnected',
    phone: payload.phone ?? (instance.phone as string),
    ...(isConnected ? { connected_at: new Date().toISOString() } : {}),
  } as Parameters<typeof updateInstance>[2]);

  // Re-configure webhooks on connection to ensure they point to the current app URL
  if (isConnected) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
    if (appUrl) {
      const creds: zapi.ZApiCredentials = {
        instanceId: instance.instance_id as string,
        token: instance.instance_token as string,
        clientToken: (instance.client_token as string) ?? undefined,
      };
      const baseWebhookUrl = `${appUrl}/api/whatsapp/webhook/${instance.id as string}`;
      zapi.configureAllWebhooks(creds, baseWebhookUrl).catch((err) => {
        console.error('[whatsapp-webhook] Failed to re-configure webhooks on connect:', err);
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractMessageContent(payload: ZApiIncomingMessage): {
  messageType: string;
  textBody?: string;
  mediaUrl?: string;
  mediaMimeType?: string;
  mediaFilename?: string;
  mediaCaption?: string;
  latitude?: number;
  longitude?: number;
} {
  if ('text' in payload && payload.text) {
    return { messageType: 'text', textBody: payload.text.message };
  }
  if ('image' in payload && payload.image) {
    return {
      messageType: 'image',
      mediaUrl: payload.image.imageUrl,
      mediaMimeType: payload.image.mimeType,
      mediaCaption: payload.image.caption,
    };
  }
  if ('video' in payload && payload.video) {
    return {
      messageType: 'video',
      mediaUrl: payload.video.videoUrl,
      mediaMimeType: payload.video.mimeType,
      mediaCaption: payload.video.caption,
    };
  }
  if ('audio' in payload && payload.audio) {
    return {
      messageType: 'audio',
      mediaUrl: payload.audio.audioUrl,
      mediaMimeType: payload.audio.mimeType,
    };
  }
  if ('document' in payload && payload.document) {
    return {
      messageType: 'document',
      mediaUrl: payload.document.documentUrl,
      mediaMimeType: payload.document.mimeType,
      mediaFilename: payload.document.fileName || payload.document.title,
    };
  }
  if ('sticker' in payload && payload.sticker) {
    return {
      messageType: 'sticker',
      mediaUrl: payload.sticker.stickerUrl,
      mediaMimeType: payload.sticker.mimeType,
    };
  }
  if ('location' in payload && payload.location) {
    return {
      messageType: 'location',
      latitude: payload.location.latitude,
      longitude: payload.location.longitude,
    };
  }
  if ('reaction' in payload && payload.reaction) {
    return {
      messageType: 'reaction',
      textBody: payload.reaction.value,
    };
  }

  return { messageType: 'text', textBody: '[Mensagem não suportada]' };
}
