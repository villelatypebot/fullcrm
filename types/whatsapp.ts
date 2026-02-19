/**
 * @fileoverview WhatsApp / Z-API type definitions for FullHouse CRM.
 */

// =============================================================================
// WHATSAPP INSTANCE
// =============================================================================

export type WhatsAppInstanceStatus = 'disconnected' | 'connecting' | 'connected' | 'banned';

export interface WhatsAppInstance {
  id: string;
  organization_id: string;
  instance_id: string;     // Z-API instance ID
  instance_token: string;  // Z-API instance token
  client_token?: string;   // Z-API client token (optional)
  name: string;
  phone?: string;
  status: WhatsAppInstanceStatus;
  webhook_url?: string;
  ai_enabled: boolean;
  connected_at?: string;
  created_at: string;
  updated_at: string;
}

export interface WhatsAppInstanceCreate {
  instance_id: string;
  instance_token: string;
  client_token?: string;
  name: string;
}

// =============================================================================
// WHATSAPP CONVERSATIONS
// =============================================================================

export type ConversationStatus = 'open' | 'closed' | 'archived';

export interface WhatsAppConversation {
  id: string;
  instance_id: string;
  organization_id: string;
  phone: string;
  contact_name?: string;
  contact_photo?: string;
  is_group: boolean;
  contact_id?: string;
  status: ConversationStatus;
  ai_active: boolean;
  ai_paused_by?: string;
  ai_paused_at?: string;
  ai_pause_reason?: string;
  last_message_text?: string;
  last_message_at?: string;
  last_message_from_me?: boolean;
  unread_count: number;
  created_at: string;
  updated_at: string;
  // Joined relations
  contact?: {
    id: string;
    name: string;
    email?: string;
    phone?: string;
  };
}

// =============================================================================
// WHATSAPP MESSAGES
// =============================================================================

export type MessageType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contact'
  | 'reaction'
  | 'poll'
  | 'button_response'
  | 'list_response'
  | 'system';

export type MessageStatus = 'pending' | 'sent' | 'received' | 'read' | 'failed' | 'deleted';

export interface WhatsAppMessage {
  id: string;
  conversation_id: string;
  organization_id: string;
  zapi_message_id?: string;
  from_me: boolean;
  sender_name?: string;
  message_type: MessageType;
  text_body?: string;
  media_url?: string;
  media_mime_type?: string;
  media_filename?: string;
  media_caption?: string;
  latitude?: number;
  longitude?: number;
  quoted_message_id?: string;
  quoted_text?: string;
  status: MessageStatus;
  sent_by?: string;
  whatsapp_timestamp?: string;
  created_at: string;
}

// =============================================================================
// WHATSAPP AI CONFIGURATION
// =============================================================================

export type AgentTone = 'professional' | 'friendly' | 'casual' | 'formal';

export interface WhatsAppAIConfig {
  id: string;
  instance_id: string;
  organization_id: string;
  agent_name: string;
  agent_role?: string;
  agent_tone: AgentTone;
  system_prompt: string;
  reply_delay_ms: number;
  max_messages_per_conversation?: number;
  auto_pause_on_human_reply: boolean;
  greeting_message?: string;
  away_message?: string;
  transfer_message: string;
  working_hours_start?: string;
  working_hours_end?: string;
  working_days: number[];
  outside_hours_message?: string;
  auto_create_contact: boolean;
  auto_create_deal: boolean;
  default_board_id?: string;
  default_stage_id?: string;
  default_tags: string[];
  created_at: string;
  updated_at: string;
}

export interface WhatsAppAIConfigUpdate {
  agent_name?: string;
  agent_role?: string;
  agent_tone?: AgentTone;
  system_prompt?: string;
  reply_delay_ms?: number;
  max_messages_per_conversation?: number;
  auto_pause_on_human_reply?: boolean;
  greeting_message?: string;
  away_message?: string;
  transfer_message?: string;
  working_hours_start?: string | null;
  working_hours_end?: string | null;
  working_days?: number[];
  outside_hours_message?: string;
  auto_create_contact?: boolean;
  auto_create_deal?: boolean;
  default_board_id?: string | null;
  default_stage_id?: string | null;
  default_tags?: string[];
}

// =============================================================================
// Z-API WEBHOOK PAYLOADS
// =============================================================================

export interface ZApiWebhookBase {
  instanceId: string;
  phone: string;
  connectedPhone?: string;
  isGroup: boolean;
  messageId: string;
  momment: number;        // Unix timestamp (ms)
  status: string;
  chatName?: string;
  senderName?: string;
  senderPhoto?: string;
  fromMe: boolean;
}

export interface ZApiTextMessage extends ZApiWebhookBase {
  type: 'ReceivedCallback';
  text: { message: string };
}

export interface ZApiImageMessage extends ZApiWebhookBase {
  type: 'ReceivedCallback';
  image: {
    imageUrl: string;
    thumbnailUrl?: string;
    caption?: string;
    mimeType: string;
  };
}

export interface ZApiVideoMessage extends ZApiWebhookBase {
  type: 'ReceivedCallback';
  video: {
    videoUrl: string;
    caption?: string;
    mimeType: string;
  };
}

export interface ZApiAudioMessage extends ZApiWebhookBase {
  type: 'ReceivedCallback';
  audio: {
    audioUrl: string;
    mimeType: string;
  };
}

export interface ZApiDocumentMessage extends ZApiWebhookBase {
  type: 'ReceivedCallback';
  document: {
    documentUrl: string;
    mimeType: string;
    title?: string;
    fileName?: string;
  };
}

export interface ZApiStickerMessage extends ZApiWebhookBase {
  type: 'ReceivedCallback';
  sticker: {
    stickerUrl: string;
    mimeType: string;
  };
}

export interface ZApiLocationMessage extends ZApiWebhookBase {
  type: 'ReceivedCallback';
  location: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
}

export interface ZApiReactionMessage extends ZApiWebhookBase {
  type: 'ReceivedCallback';
  reaction: {
    value: string;
    reactionBy: string;
    referenceMessageId: string;
  };
}

export type ZApiIncomingMessage =
  | ZApiTextMessage
  | ZApiImageMessage
  | ZApiVideoMessage
  | ZApiAudioMessage
  | ZApiDocumentMessage
  | ZApiStickerMessage
  | ZApiLocationMessage
  | ZApiReactionMessage;

// Message status webhook
export interface ZApiMessageStatus {
  instanceId: string;
  messageId: string;
  phone: string;
  status: 'SENT' | 'RECEIVED' | 'READ' | 'PLAYED' | 'DELETED';
  momment: number;
}

// Connection webhook
export interface ZApiConnectionEvent {
  instanceId: string;
  connected: boolean;
  phone?: string;
  smartphoneConnected?: boolean;
}

// =============================================================================
// AI AGENT LOG
// =============================================================================

export type AILogAction =
  | 'replied'
  | 'paused'
  | 'resumed'
  | 'escalated'
  | 'contact_created'
  | 'deal_created'
  | 'stage_changed'
  | 'tag_added'
  | 'error';

export interface WhatsAppAILog {
  id: string;
  conversation_id: string;
  organization_id: string;
  action: AILogAction;
  details: Record<string, unknown>;
  message_id?: string;
  triggered_by?: string;
  created_at: string;
}
