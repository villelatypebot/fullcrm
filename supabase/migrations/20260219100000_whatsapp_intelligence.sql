-- =============================================================================
-- WHATSAPP INTELLIGENCE ENGINE - FullHouse CRM
-- =============================================================================
--
-- Created at: 2026-02-19
-- Purpose: Autonomous AI agent with memory, smart follow-ups, auto-labeling,
--          lead scoring, conversation intelligence, and intent detection.
--
-- New Tables:
-- 1. whatsapp_chat_memory         - Persistent memory per contact
-- 2. whatsapp_follow_ups          - Smart scheduled follow-ups
-- 3. whatsapp_labels              - Conversation labels/tags
-- 4. whatsapp_conversation_labels - Many-to-many label assignment
-- 5. whatsapp_lead_scores         - Lead scoring + temperature
-- 6. whatsapp_conversation_summaries - AI-generated conversation summaries
--
-- Modified Tables:
-- - whatsapp_ai_config            - New fields for intelligence features
-- - whatsapp_ai_logs              - New action types
--
-- =============================================================================


-- #############################################################################
-- TABLE 1: CHAT MEMORY
-- #############################################################################
-- Persistent memory per contact. The AI extracts and remembers facts from
-- every conversation: names, preferences, objections, timelines, budgets, etc.
-- This is what makes the AI feel "human" - it remembers everything.

CREATE TABLE IF NOT EXISTS public.whatsapp_chat_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,

    -- Memory classification
    memory_type TEXT NOT NULL CHECK (memory_type IN (
        'fact',           -- General fact about the person
        'preference',     -- Something they prefer/want
        'objection',      -- An objection or concern they raised
        'family',         -- Family member info (spouse name, kids, etc.)
        'timeline',       -- Time-related info (when they want something, deadlines)
        'budget',         -- Budget/financial info
        'interest',       -- Product/service interest
        'personal',       -- Personal info (birthday, job, company)
        'interaction'     -- How they like to be treated, communication style
    )),

    -- The actual memory
    key TEXT NOT NULL,               -- e.g. 'spouse_name', 'preferred_unit', 'budget_range'
    value TEXT NOT NULL,             -- e.g. 'Maria', '2 quartos', 'R$ 300k-500k'
    context TEXT,                    -- Additional context for the AI

    -- Traceability
    source_message_id UUID REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
    confidence REAL DEFAULT 0.8 CHECK (confidence >= 0 AND confidence <= 1),

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.whatsapp_chat_memory ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_chat_memory_conversation
    ON public.whatsapp_chat_memory(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_memory_contact
    ON public.whatsapp_chat_memory(contact_id);
CREATE INDEX IF NOT EXISTS idx_chat_memory_org
    ON public.whatsapp_chat_memory(organization_id);
CREATE INDEX IF NOT EXISTS idx_chat_memory_type
    ON public.whatsapp_chat_memory(memory_type);

CREATE POLICY "chat_memory_select" ON public.whatsapp_chat_memory
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "chat_memory_insert" ON public.whatsapp_chat_memory
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "chat_memory_update" ON public.whatsapp_chat_memory
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "chat_memory_delete" ON public.whatsapp_chat_memory
    FOR DELETE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );


-- #############################################################################
-- TABLE 2: SMART FOLLOW-UPS
-- #############################################################################
-- The crown jewel. AI detects intent from messages and schedules contextual
-- follow-ups. "Vou ver com meu esposo" → 30min later: "Conversou com ele?"
--
-- A cron job (or Vercel cron) checks every minute for pending follow-ups
-- and triggers them via the AI agent.

CREATE TABLE IF NOT EXISTS public.whatsapp_follow_ups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    instance_id UUID NOT NULL REFERENCES public.whatsapp_instances(id) ON DELETE CASCADE,

    -- When to trigger
    trigger_at TIMESTAMPTZ NOT NULL,

    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending',       -- Waiting to be sent
        'sent',          -- Successfully sent
        'cancelled',     -- Cancelled (human took over, or customer replied)
        'failed',        -- Failed to send
        'skipped'        -- Skipped (customer already replied before trigger)
    )),

    -- Follow-up classification
    follow_up_type TEXT NOT NULL DEFAULT 'smart' CHECK (follow_up_type IN (
        'smart',         -- AI-detected intent-based follow-up
        'scheduled',     -- Manually scheduled by user
        'reminder',      -- Simple reminder
        'nurture',       -- Long-term nurture sequence
        'reactivation'   -- Re-engage inactive contact
    )),

    -- What triggered this follow-up
    detected_intent TEXT,             -- 'check_with_spouse', 'think_about_it', 'budget_hold', etc.
    intent_confidence REAL DEFAULT 0.8,

    -- Context for generating the follow-up message
    context JSONB DEFAULT '{}',       -- Key points from conversation, customer name, etc.
    original_customer_message TEXT,    -- The exact message that triggered this
    ai_generated_message TEXT,        -- Pre-generated message (or null = generate at send time)
    custom_instructions TEXT,         -- Extra instructions for AI when generating

    -- Traceability
    original_message_id UUID REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
    sent_message_id UUID REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
    created_by TEXT DEFAULT 'ai',     -- 'ai' or 'user:<profile_id>'

    -- Retry logic
    max_retries INTEGER DEFAULT 2,
    retry_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    sent_at TIMESTAMPTZ
);

ALTER TABLE public.whatsapp_follow_ups ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_follow_ups_pending
    ON public.whatsapp_follow_ups(trigger_at)
    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_follow_ups_conversation
    ON public.whatsapp_follow_ups(conversation_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_org
    ON public.whatsapp_follow_ups(organization_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status
    ON public.whatsapp_follow_ups(status);

CREATE POLICY "follow_ups_select" ON public.whatsapp_follow_ups
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "follow_ups_insert" ON public.whatsapp_follow_ups
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "follow_ups_update" ON public.whatsapp_follow_ups
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "follow_ups_delete" ON public.whatsapp_follow_ups
    FOR DELETE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );


-- #############################################################################
-- TABLE 3: LABELS
-- #############################################################################
-- Labels for organizing conversations. Can be assigned manually or auto-assigned
-- by the AI based on conversation analysis.

CREATE TABLE IF NOT EXISTS public.whatsapp_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',        -- Hex color
    icon TEXT,                           -- Optional lucide icon name
    description TEXT,

    -- Auto-assignment (AI assigns based on these conditions)
    auto_assign BOOLEAN DEFAULT false,
    auto_assign_conditions JSONB,       -- e.g. { "intents": ["interested"], "min_score": 70 }

    -- System labels can't be deleted (hot, warm, cold, etc.)
    is_system BOOLEAN DEFAULT false,

    -- Ordering
    sort_order INTEGER DEFAULT 0,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(organization_id, name)
);

ALTER TABLE public.whatsapp_labels ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_labels_org
    ON public.whatsapp_labels(organization_id);

CREATE POLICY "labels_select" ON public.whatsapp_labels
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "labels_insert" ON public.whatsapp_labels
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "labels_update" ON public.whatsapp_labels
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "labels_delete" ON public.whatsapp_labels
    FOR DELETE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );


-- #############################################################################
-- TABLE 4: CONVERSATION LABELS (Many-to-Many)
-- #############################################################################

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_labels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
    label_id UUID NOT NULL REFERENCES public.whatsapp_labels(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    assigned_by TEXT DEFAULT 'ai',     -- 'ai', 'user:<profile_id>', 'auto_rule'
    reason TEXT,                        -- Why this label was assigned

    assigned_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(conversation_id, label_id)
);

ALTER TABLE public.whatsapp_conversation_labels ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_conv_labels_conversation
    ON public.whatsapp_conversation_labels(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_labels_label
    ON public.whatsapp_conversation_labels(label_id);

CREATE POLICY "conv_labels_select" ON public.whatsapp_conversation_labels
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "conv_labels_insert" ON public.whatsapp_conversation_labels
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "conv_labels_delete" ON public.whatsapp_conversation_labels
    FOR DELETE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );


-- #############################################################################
-- TABLE 5: LEAD SCORING
-- #############################################################################
-- Automatic lead scoring based on conversation analysis.
-- Updated after every message exchange.

CREATE TABLE IF NOT EXISTS public.whatsapp_lead_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE UNIQUE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,

    -- Score
    score INTEGER DEFAULT 0 CHECK (score >= 0 AND score <= 100),
    temperature TEXT DEFAULT 'cold' CHECK (temperature IN ('cold', 'warm', 'hot', 'on_fire')),

    -- Score breakdown
    factors JSONB DEFAULT '{}',
    -- Example:
    -- {
    --   "response_speed": 15,     -- How fast they reply
    --   "message_count": 10,      -- How many messages exchanged
    --   "buying_signals": 25,     -- "Quanto custa?", "Tem disponibilidade?"
    --   "engagement": 20,         -- Questions asked, details requested
    --   "objection_resolution": 10, -- Objections were addressed
    --   "intent_positive": 20     -- Positive intent signals
    -- }

    -- Buying stage
    buying_stage TEXT DEFAULT 'awareness' CHECK (buying_stage IN (
        'awareness',      -- Just discovered
        'interest',       -- Showing interest
        'consideration',  -- Comparing options
        'decision',       -- Ready to decide
        'negotiation',    -- Negotiating terms
        'closed_won',     -- Converted
        'closed_lost'     -- Lost
    )),

    -- History
    score_history JSONB DEFAULT '[]',  -- Array of { score, timestamp, reason }

    -- Timestamps
    last_calculated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.whatsapp_lead_scores ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_lead_scores_org
    ON public.whatsapp_lead_scores(organization_id);
CREATE INDEX IF NOT EXISTS idx_lead_scores_temp
    ON public.whatsapp_lead_scores(temperature);
CREATE INDEX IF NOT EXISTS idx_lead_scores_score
    ON public.whatsapp_lead_scores(score DESC);

CREATE POLICY "lead_scores_select" ON public.whatsapp_lead_scores
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "lead_scores_insert" ON public.whatsapp_lead_scores
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "lead_scores_update" ON public.whatsapp_lead_scores
    FOR UPDATE USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );


-- #############################################################################
-- TABLE 6: CONVERSATION SUMMARIES
-- #############################################################################
-- AI-generated summaries after each meaningful conversation exchange.
-- This gives the human agent instant context when they take over.

CREATE TABLE IF NOT EXISTS public.whatsapp_conversation_summaries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

    -- Summary
    summary TEXT NOT NULL,
    key_points JSONB DEFAULT '[]',       -- Array of strings: main takeaways
    next_actions JSONB DEFAULT '[]',      -- Array of strings: recommended next steps
    customer_sentiment TEXT CHECK (customer_sentiment IN (
        'very_positive', 'positive', 'neutral', 'negative', 'very_negative'
    )),

    -- What triggered this summary
    trigger_reason TEXT DEFAULT 'periodic',  -- 'periodic', 'handoff', 'follow_up', 'close'
    message_range_start UUID REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
    message_range_end UUID REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.whatsapp_conversation_summaries ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_conv_summaries_conversation
    ON public.whatsapp_conversation_summaries(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_summaries_org
    ON public.whatsapp_conversation_summaries(organization_id);

CREATE POLICY "conv_summaries_select" ON public.whatsapp_conversation_summaries
    FOR SELECT USING (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );

CREATE POLICY "conv_summaries_insert" ON public.whatsapp_conversation_summaries
    FOR INSERT WITH CHECK (
        organization_id IN (
            SELECT organization_id FROM public.profiles WHERE id = auth.uid()
        )
    );


-- #############################################################################
-- ALTER: WHATSAPP AI CONFIG - New intelligence fields
-- #############################################################################

ALTER TABLE public.whatsapp_ai_config
    ADD COLUMN IF NOT EXISTS memory_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS follow_up_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS auto_label_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS lead_scoring_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS summary_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS smart_pause_enabled BOOLEAN DEFAULT true,
    ADD COLUMN IF NOT EXISTS follow_up_default_delay_minutes INTEGER DEFAULT 30,
    ADD COLUMN IF NOT EXISTS follow_up_max_per_conversation INTEGER DEFAULT 3,
    ADD COLUMN IF NOT EXISTS follow_up_quiet_hours_start TIME,
    ADD COLUMN IF NOT EXISTS follow_up_quiet_hours_end TIME;


-- #############################################################################
-- ALTER: WHATSAPP AI LOGS - New action types
-- #############################################################################

ALTER TABLE public.whatsapp_ai_logs
    DROP CONSTRAINT IF EXISTS whatsapp_ai_logs_action_check;

ALTER TABLE public.whatsapp_ai_logs
    ADD CONSTRAINT whatsapp_ai_logs_action_check CHECK (action IN (
        'replied',
        'paused',
        'resumed',
        'escalated',
        'contact_created',
        'deal_created',
        'stage_changed',
        'tag_added',
        'error',
        -- New intelligence actions
        'memory_extracted',
        'follow_up_scheduled',
        'follow_up_sent',
        'follow_up_cancelled',
        'label_assigned',
        'label_removed',
        'lead_score_updated',
        'summary_generated',
        'intent_detected',
        'smart_paused',
        'smart_resumed',
        'stage_auto_changed',
        'deal_auto_updated'
    ));


-- #############################################################################
-- TRIGGER: Auto-cancel follow-ups when customer replies
-- #############################################################################
-- If a customer sends a message, cancel any pending follow-ups for that
-- conversation (the AI will re-evaluate after processing the new message).

CREATE OR REPLACE FUNCTION public.auto_cancel_follow_ups_on_reply()
RETURNS TRIGGER AS $$
BEGIN
    -- Only for incoming messages (not from us)
    IF NOT NEW.from_me THEN
        UPDATE public.whatsapp_follow_ups
        SET
            status = 'skipped',
            updated_at = NOW()
        WHERE conversation_id = NEW.conversation_id
          AND status = 'pending';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_auto_cancel_follow_ups
    AFTER INSERT ON public.whatsapp_messages
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_cancel_follow_ups_on_reply();


-- #############################################################################
-- SEED: Default system labels
-- #############################################################################
-- These get created per-organization when the feature is first used.
-- We'll handle this in the application code instead of SQL to avoid
-- needing to know the organization_id at migration time.

-- Function to create default labels for an organization
CREATE OR REPLACE FUNCTION public.create_default_whatsapp_labels(org_id UUID)
RETURNS VOID AS $$
BEGIN
    INSERT INTO public.whatsapp_labels (organization_id, name, color, icon, is_system, sort_order, auto_assign, description)
    VALUES
        (org_id, 'Quente',       '#ef4444', 'flame',       true, 1, true,  'Lead muito interessado, alta probabilidade de conversão'),
        (org_id, 'Morno',        '#f59e0b', 'thermometer', true, 2, true,  'Lead com interesse moderado'),
        (org_id, 'Frio',         '#3b82f6', 'snowflake',   true, 3, true,  'Lead com pouco interesse ou contato inicial'),
        (org_id, 'Interessado',  '#10b981', 'star',        true, 4, true,  'Demonstrou interesse ativo em produto/serviço'),
        (org_id, 'Objeção',      '#f97316', 'shield',      true, 5, true,  'Levantou objeções ou preocupações'),
        (org_id, 'Aguardando',   '#8b5cf6', 'clock',       true, 6, true,  'Aguardando resposta ou decisão do cliente'),
        (org_id, 'Negociando',   '#06b6d4', 'handshake',   true, 7, true,  'Em fase de negociação ativa'),
        (org_id, 'Fechado',      '#22c55e', 'check-circle',true, 8, false, 'Negócio fechado/convertido'),
        (org_id, 'Perdido',      '#6b7280', 'x-circle',    true, 9, false, 'Lead perdido ou desistiu')
    ON CONFLICT (organization_id, name) DO NOTHING;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- #############################################################################
-- REALTIME: Enable for new tables
-- #############################################################################

ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_follow_ups;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_conversation_labels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_lead_scores;
