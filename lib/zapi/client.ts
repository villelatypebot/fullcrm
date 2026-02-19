/**
 * Z-API HTTP client for WhatsApp integration.
 *
 * All calls go through `https://api.z-api.io/instances/{instanceId}/token/{token}/...`
 */

const ZAPI_BASE = 'https://api.z-api.io/instances';

export interface ZApiCredentials {
  instanceId: string;
  token: string;
  clientToken?: string;
}

// ---------------------------------------------------------------------------
// Internal helper
// ---------------------------------------------------------------------------

async function zapiRequest<T = unknown>(
  creds: ZApiCredentials,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${ZAPI_BASE}/${creds.instanceId}/token/${creds.token}${path}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(creds.clientToken ? { 'Client-Token': creds.clientToken } : {}),
    ...(options.headers as Record<string, string> | undefined),
  };

  const res = await fetch(url, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Z-API ${res.status}: ${body}`);
  }

  // Some Z-API endpoints return empty body
  const text = await res.text();
  if (!text) return undefined as T;

  return JSON.parse(text) as T;
}

// ---------------------------------------------------------------------------
// Instance / Connection
// ---------------------------------------------------------------------------

export interface QrCodeResponse {
  value: string; // base64 image or url
  connected?: boolean;
}

export function getQrCode(creds: ZApiCredentials): Promise<QrCodeResponse> {
  return zapiRequest<QrCodeResponse>(creds, '/qr-code/image');
}

export function getInstanceStatus(creds: ZApiCredentials): Promise<{
  connected: boolean;
  smartphoneConnected?: boolean;
  session?: string;
  error?: string;
}> {
  return zapiRequest(creds, '/status');
}

export function restartInstance(creds: ZApiCredentials): Promise<{ value: boolean }> {
  return zapiRequest(creds, '/restart');
}

export function disconnectInstance(creds: ZApiCredentials): Promise<{ value: boolean }> {
  return zapiRequest(creds, '/disconnect');
}

export function getDeviceInfo(creds: ZApiCredentials): Promise<{
  phone?: string;
  name?: string;
  imgUrl?: string;
}> {
  return zapiRequest(creds, '/device');
}

// ---------------------------------------------------------------------------
// Sending Messages
// ---------------------------------------------------------------------------

export interface SendTextPayload {
  phone: string;
  message: string;
  messageId?: string; // for replies
}

export interface SendMessageResponse {
  zapiMessageId?: string;
  messageId?: string;
  id?: string;
}

export function sendText(creds: ZApiCredentials, payload: SendTextPayload): Promise<SendMessageResponse> {
  return zapiRequest<SendMessageResponse>(creds, '/send-text', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface SendImagePayload {
  phone: string;
  image: string;   // URL or base64
  caption?: string;
}

export function sendImage(creds: ZApiCredentials, payload: SendImagePayload): Promise<SendMessageResponse> {
  return zapiRequest<SendMessageResponse>(creds, '/send-image', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface SendDocumentPayload {
  phone: string;
  document: string;  // URL or base64
  fileName?: string;
  caption?: string;
}

export function sendDocument(
  creds: ZApiCredentials,
  payload: SendDocumentPayload,
  extension: string = 'pdf',
): Promise<SendMessageResponse> {
  return zapiRequest<SendMessageResponse>(creds, `/send-document/${extension}`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export interface SendAudioPayload {
  phone: string;
  audio: string;  // URL or base64
}

export function sendAudio(creds: ZApiCredentials, payload: SendAudioPayload): Promise<SendMessageResponse> {
  return zapiRequest<SendMessageResponse>(creds, '/send-audio', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ---------------------------------------------------------------------------
// Message management
// ---------------------------------------------------------------------------

export function markAsRead(creds: ZApiCredentials, phone: string, messageId: string): Promise<void> {
  return zapiRequest(creds, '/read-message', {
    method: 'POST',
    body: JSON.stringify({ phone, messageId }),
  });
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

export function checkPhoneExists(creds: ZApiCredentials, phone: string): Promise<{ exists: boolean }> {
  return zapiRequest(creds, `/phone-exists/${phone}`);
}

// ---------------------------------------------------------------------------
// Webhook Configuration
// ---------------------------------------------------------------------------

export function updateWebhookReceived(creds: ZApiCredentials, url: string): Promise<void> {
  return zapiRequest(creds, '/update-webhook-received', {
    method: 'PUT',
    body: JSON.stringify({ value: url }),
  });
}

export function updateWebhookMessageStatus(creds: ZApiCredentials, url: string): Promise<void> {
  return zapiRequest(creds, '/update-webhook-message-status', {
    method: 'PUT',
    body: JSON.stringify({ value: url }),
  });
}

export function updateWebhookConnected(creds: ZApiCredentials, url: string): Promise<void> {
  return zapiRequest(creds, '/update-webhook-connected', {
    method: 'PUT',
    body: JSON.stringify({ value: url }),
  });
}

export function updateWebhookDisconnected(creds: ZApiCredentials, url: string): Promise<void> {
  return zapiRequest(creds, '/update-webhook-disconnected', {
    method: 'PUT',
    body: JSON.stringify({ value: url }),
  });
}

/** Configure all Z-API webhooks to point to our endpoints. */
export async function configureAllWebhooks(
  creds: ZApiCredentials,
  baseWebhookUrl: string,
): Promise<void> {
  await Promise.all([
    updateWebhookReceived(creds, `${baseWebhookUrl}/message-received`),
    updateWebhookMessageStatus(creds, `${baseWebhookUrl}/message-status`),
    updateWebhookConnected(creds, `${baseWebhookUrl}/connection`),
    updateWebhookDisconnected(creds, `${baseWebhookUrl}/connection`),
  ]);
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

export interface ZApiChat {
  phone: string;
  name?: string;
  unreadMessages?: number;
  lastMessageTimestamp?: number;
  isGroup?: boolean;
}

export function getChats(creds: ZApiCredentials): Promise<ZApiChat[]> {
  return zapiRequest<ZApiChat[]>(creds, '/chats');
}

// ---------------------------------------------------------------------------
// Labels (WhatsApp Business)
// ---------------------------------------------------------------------------

export interface ZApiLabel {
  id: string;
  name: string;
  color: number;
}

export function getLabels(creds: ZApiCredentials): Promise<ZApiLabel[]> {
  return zapiRequest<ZApiLabel[]>(creds, '/tags');
}

export function addLabelToChat(creds: ZApiCredentials, phone: string, tagId: string): Promise<void> {
  return zapiRequest(creds, `/chats/${phone}/tags/${tagId}/add`, { method: 'PUT' });
}

export function removeLabelFromChat(creds: ZApiCredentials, phone: string, tagId: string): Promise<void> {
  return zapiRequest(creds, `/chats/${phone}/tags/${tagId}/remove`, { method: 'PUT' });
}
