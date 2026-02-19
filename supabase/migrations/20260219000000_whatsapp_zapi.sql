-- =============================================================================
-- WHATSAPP INTEGRATION (Z-API) - FullHouse CRM
-- =============================================================================
--
-- Created at: 2026-02-19
-- Purpose: Full WhatsApp integration via Z-API with AI agent support
--
-- Tables:
-- 1. whatsapp_instances       - Z-API instance configuration
-- 2. whatsapp_conversations   - Chat threads (linked to CRM contacts)
-- 3. whatsapp_messages        - Individual messages in conversations
-- 4. whatsapp_ai_config       - AI agent configuration per instance
-- 5. whatsapp_ai_logs         - AI agent action audit trail
--
-- =============================================================================

-- #############################################################################
-- TABLE 1: WHATSAPP INSTANCES
-- #############################################################################
-- Each instance represents a connected WhatsApp number via Z-API.

CREATE TABLE IF NOT EXISTS public.whatsapp_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Z-API credentials
    instance_id TEXT NOT NULL,           -- Z-API instance ID
    instance_token TEXT NOT NULL,        -- Z-API instance token
    client_token TEXT,                   -- Z-API account security token (optional)

    -- Instance metadata
    name TEXT NOT NULL DEFAULT 'WhatsApp Principal',  -- Friendly name
    phone TEXT,                          -- Connected phone number (filled after QR scan)
    status TEXT NOT NULL DEFAULT 'disconnected'
        CHECK (status IN ('disconnected', 'connecting', 'connected', 'banned')),

    -- Webhook configuration
    webhook_url TEXT,                    -- Base webhook URL for this instance

    -- AI agent toggle
    ai_enabled BOOLEAN NOT NULL DEFAULT false,

    -- Timestamps
    connected_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.whatsapp_instances ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_whatsapp_instances_org
    ON public.whatsapp_instances(organization_id);

-- RLS: members of the organization can read; admins can write
CREATE POLICY "whatsapp_instances_select" ON public.whatsapp_instances
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "whatsapp_instances_insert" ON public.whatsapp_instances
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "whatsapp_instances_update" ON public.whatsapp_instances
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "whatsapp_instances_delete" ON public.whatsapp_instances
    FOR DELETE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );


-- #############################################################################
-- TABLE 2: WHATSAPP CONVERSATIONS
-- #############################################################################
-- Each conversation is a chat thread with a WhatsApp contact.

CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- WhatsApp contact identification
    phone TEXT NOT NULL,                 -- Remote phone number (e.g. 5511999999999)
    contact_name TEXT,                   -- Name from WhatsApp profile
    contact_photo TEXT,                  -- Profile photo URL (expires in 48h)
    is_group BOOLEAN NOT NULL DEFAULT false,

    -- CRM link
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,

    -- Conversation state
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'closed', 'archived')),

    -- AI agent state per conversation
    ai_active BOOLEAN NOT NULL DEFAULT true,  -- Is AI responding in this chat?
    ai_paused_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,  -- Who paused the AI
    ai_paused_at TIMESTAMPTZ,
    ai_pause_reason TEXT,                -- 'manual_takeover', 'panel_stop', 'human_reply'

    -- Last message preview (for conversation list)
    last_message_text TEXT,
    last_message_at TIMESTAMPTZ,
    last_message_from_me BOOLEAN DEFAULT false,
    unread_count INTEGER NOT NULL DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Unique constraint: one conversation per phone per instance
    UNIQUE(instance_id, phone)
);

ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_instance
    ON public.whatsapp_conversations(instance_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_org
    ON public.whatsapp_conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_contact
    ON public.whatsapp_conversations(contact_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_phone
    ON public.whatsapp_conversations(phone);
CREATE INDEX IF NOT EXISTS idx_whatsapp_conversations_last_msg
    ON public.whatsapp_conversations(last_message_at DESC NULLS LAST);

-- RLS: organization members can access conversations
CREATE POLICY "whatsapp_conversations_select" ON public.whatsapp_conversations
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "whatsapp_conversations_insert" ON public.whatsapp_conversations
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "whatsapp_conversations_update" ON public.whatsapp_conversations
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );


-- #############################################################################
-- TABLE 3: WHATSAPP MESSAGES
-- #############################################################################

CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Z-API message identification
    zapi_message_id TEXT,                -- Z-API message ID (for status tracking)

    -- Message content
    from_me BOOLEAN NOT NULL DEFAULT false,
    sender_name TEXT,
    message_type TEXT NOT NULL DEFAULT 'text'
        CHECK (message_type IN (
            'text', 'image', 'video', 'audio', 'document', 'sticker',
            'location', 'contact', 'reaction', 'poll', 'button_response',
            'list_response', 'system'
        )),

    -- Content fields (depends on message_type)
    text_body TEXT,                      -- Text content
    media_url TEXT,                      -- URL for media messages
    media_mime_type TEXT,                -- MIME type of media
    media_filename TEXT,                 -- Original filename for documents
    media_caption TEXT,                  -- Caption for image/video/document
    latitude DOUBLE PRECISION,           -- For location messages
    longitude DOUBLE PRECISION,          -- For location messages

    -- Reply context
    quoted_message_id TEXT,              -- Z-API ID of quoted message
    quoted_text TEXT,                    -- Preview text of quoted message

    -- Delivery status
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sent', 'received', 'read', 'failed', 'deleted')),

    -- Who sent this (for outbound)
    sent_by TEXT                         -- 'ai_agent', 'user:<profile_id>', 'system'
        CHECK (sent_by IS NULL OR sent_by ~ '^(ai_agent|user:[0-9a-f-]+|system)$'),

    -- Timestamps
    whatsapp_timestamp TIMESTAMPTZ,      -- Timestamp from WhatsApp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_conversation
    ON public.whatsapp_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_org
    ON public.whatsapp_messages(organization_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_zapi_id
    ON public.whatsapp_messages(zapi_message_id);

-- RLS: organization members can access messages
CREATE POLICY "whatsapp_messages_select" ON public.whatsapp_messages
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "whatsapp_messages_insert" ON public.whatsapp_messages
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "whatsapp_messages_update" ON public.whatsapp_messages
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );


-- #############################################################################
-- TABLE 4: WHATSAPP AI CONFIGURATION
-- #############################################################################
-- AI agent configuration per WhatsApp instance.

CREATE TABLE IF NOT EXISTS public.whatsapp_ai_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE UNIQUE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Agent persona
    agent_name TEXT NOT NULL DEFAULT 'Assistente FullHouse',
    agent_role TEXT DEFAULT 'Atendente virtual',
    agent_tone TEXT DEFAULT 'professional'
        CHECK (agent_tone IN ('professional', 'friendly', 'casual', 'formal')),

    -- System prompt (custom instructions for the AI)
    system_prompt TEXT NOT NULL DEFAULT 'Você é um assistente virtual de atendimento. Seja educado, objetivo e útil. Responda em português.',

    -- Behavior settings
    reply_delay_ms INTEGER NOT NULL DEFAULT 2000,       -- Simulated typing delay
    max_messages_per_conversation INTEGER DEFAULT 50,    -- Safety limit
    auto_pause_on_human_reply BOOLEAN NOT NULL DEFAULT true,  -- Pause AI when human replies
    greeting_message TEXT,                               -- First message when new conversation starts
    away_message TEXT,                                   -- Message when AI is paused
    transfer_message TEXT DEFAULT 'Um atendente humano irá continuar o atendimento.',

    -- Working hours (null = 24/7)
    working_hours_start TIME,            -- e.g. 08:00
    working_hours_end TIME,              -- e.g. 18:00
    working_days INTEGER[] DEFAULT '{1,2,3,4,5}',  -- 0=Sun, 1=Mon, ..., 6=Sat
    outside_hours_message TEXT DEFAULT 'Nosso horário de atendimento é de segunda a sexta, das 8h às 18h. Retornaremos em breve!',

    -- CRM integration rules
    auto_create_contact BOOLEAN NOT NULL DEFAULT true,   -- Auto-create CRM contact from WhatsApp
    auto_create_deal BOOLEAN NOT NULL DEFAULT false,     -- Auto-create deal for new contacts
    default_board_id UUID REFERENCES public.boards(id) ON DELETE SET NULL,  -- Board for auto-created deals
    default_stage_id UUID REFERENCES public.board_stages(id) ON DELETE SET NULL,  -- Stage for auto-created deals
    default_tags TEXT[] DEFAULT '{}',                    -- Tags to apply to auto-created deals

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.whatsapp_ai_config ENABLE ROW LEVEL SECURITY;

-- RLS: organization members can read; admins can write
CREATE POLICY "whatsapp_ai_config_select" ON public.whatsapp_ai_config
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "whatsapp_ai_config_upsert" ON public.whatsapp_ai_config
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );

CREATE POLICY "whatsapp_ai_config_update" ON public.whatsapp_ai_config
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles
            WHERE id = auth.uid() AND role = 'admin'
        )
    );


-- #############################################################################
-- TABLE 5: WHATSAPP AI LOGS
-- #############################################################################
-- Audit trail of AI agent actions.

CREATE TABLE IF NOT EXISTS public.whatsapp_ai_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- What happened
    action TEXT NOT NULL
        CHECK (action IN (
            'replied',           -- AI sent a reply
            'paused',            -- AI was paused (human takeover)
            'resumed',           -- AI was resumed
            'escalated',         -- AI escalated to human
            'contact_created',   -- AI created a CRM contact
            'deal_created',      -- AI created a deal
            'stage_changed',     -- AI moved a deal stage
            'tag_added',         -- AI added a tag
            'error'              -- AI encountered an error
        )),

    -- Details
    details JSONB DEFAULT '{}',          -- Action-specific data
    message_id UUID REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
    triggered_by TEXT,                   -- 'ai', 'user:<profile_id>', 'webhook'

    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.whatsapp_ai_logs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_logs_conversation
    ON public.whatsapp_ai_logs(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_whatsapp_ai_logs_org
    ON public.whatsapp_ai_logs(organization_id);

CREATE POLICY "whatsapp_ai_logs_select" ON public.whatsapp_ai_logs
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "whatsapp_ai_logs_insert" ON public.whatsapp_ai_logs
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );


-- #############################################################################
-- REALTIME PUBLICATION
-- #############################################################################
-- Enable realtime for chat updates

ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_messages;


-- #############################################################################
-- TRIGGER: UPDATE conversation last_message on new message
-- #############################################################################

CREATE OR REPLACE FUNCTION public.update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE public.whatsapp_conversations
    SET
        last_message_text = COALESCE(NEW.text_body, '[' || NEW.message_type || ']'),
        last_message_at = COALESCE(NEW.whatsapp_timestamp, NEW.created_at),
        last_message_from_me = NEW.from_me,
        unread_count = CASE
            WHEN NEW.from_me THEN 0
            ELSE unread_count + 1
        END,
        updated_at = NOW()
    WHERE id = NEW.conversation_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_whatsapp_message_insert
    AFTER INSERT ON public.whatsapp_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.update_conversation_last_message();


-- #############################################################################
-- ADD Z-API SETTINGS TO ORGANIZATION_SETTINGS
-- #############################################################################

ALTER TABLE public.organization_settings
    ADD COLUMN IF NOT EXISTS zapi_instance_id TEXT,
    ADD COLUMN IF NOT EXISTS zapi_token TEXT,
    ADD COLUMN IF NOT EXISTS zapi_client_token TEXT;
