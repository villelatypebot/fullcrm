-- =============================================================================
-- CRMIA - FULL SCHEMA INIT (CONSOLIDATED)
-- =============================================================================
-- 
-- Generated at: 2025-12-09
-- Purpose: Consolidate all previous migrations into a single file for fresh install.
-- 
-- Includes:
-- 1. Base Single-Tenant Schema
-- 2. Cockpit Features (Deal Notes, Files, Scripts)
-- 3. AI Key Separation
-- 4. Expanded System Scripts
-- 5. Board Archive Features (Won/Lost configurations)
--
-- =============================================================================

-- =============================================================================
-- PART 1: BASE SCHEMA (Originally 20251207120000_schema_v2_single_tenant.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. EXTENSÕES
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA extensions;

-- #############################################################################
-- PARTE 1: TABELAS PRINCIPAIS
-- #############################################################################

-- -----------------------------------------------------------------------------
-- 2. ORGANIZATIONS (Mantida para compatibilidade de dados)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 2.1 ORGANIZATION_SETTINGS (Config global de IA por organização)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_settings (
    organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE PRIMARY KEY,
    ai_provider text DEFAULT 'google',
    ai_model text DEFAULT 'gemini-2.5-flash',
    ai_google_key text,
    ai_openai_key text,
    ai_anthropic_key text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 3. PROFILES (Usuários - estende auth.users)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    name TEXT,
    avatar TEXT,
    role TEXT DEFAULT 'user',
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    first_name TEXT,
    last_name TEXT,
    nickname TEXT,
    phone TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 4. LIFECYCLE_STAGES (Estágios do funil - GLOBAL)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lifecycle_stages (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.lifecycle_stages ENABLE ROW LEVEL SECURITY;

INSERT INTO public.lifecycle_stages (id, name, color, "order", is_default) VALUES
('LEAD', 'Lead', 'bg-blue-500', 0, true),
('MQL', 'MQL', 'bg-yellow-500', 1, true),
('PROSPECT', 'Oportunidade', 'bg-purple-500', 2, true),
('CUSTOMER', 'Cliente', 'bg-green-500', 3, true),
('OTHER', 'Outros / Perdidos', 'bg-slate-500', 4, true)
ON CONFLICT (id) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. CRM_COMPANIES (Empresas dos CLIENTES do CRM)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crm_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    industry TEXT,
    website TEXT,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    owner_id UUID REFERENCES public.profiles(id),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE
);

ALTER TABLE public.crm_companies ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 6. BOARDS (Quadros Kanban)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.boards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    type TEXT DEFAULT 'SALES',
    is_default BOOLEAN DEFAULT false,
    template TEXT,
    linked_lifecycle_stage TEXT,
    next_board_id UUID REFERENCES public.boards(id),
    goal_description TEXT,
    goal_kpi TEXT,
    goal_target_value TEXT,
    goal_type TEXT,
    agent_name TEXT,
    agent_role TEXT,
    agent_behavior TEXT,
    entry_trigger TEXT,
    automation_suggestions TEXT[],
    position INTEGER DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    owner_id UUID REFERENCES public.profiles(id),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE
);

ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 7. BOARD_STAGES (Colunas dos quadros)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.board_stages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    board_id UUID REFERENCES public.boards(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    label TEXT,
    color TEXT,
    "order" INTEGER NOT NULL,
    is_default BOOLEAN DEFAULT false,
    linked_lifecycle_stage TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE
);

ALTER TABLE public.board_stages ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 8. CONTACTS (Contatos)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT,
    company_name TEXT,
    client_company_id UUID REFERENCES public.crm_companies(id),
    avatar TEXT,
    notes TEXT,
    status TEXT DEFAULT 'ACTIVE',
    stage TEXT DEFAULT 'LEAD',
    source TEXT,
    birth_date DATE,
    last_interaction TIMESTAMPTZ,
    last_purchase_date DATE,
    total_value NUMERIC DEFAULT 0,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    owner_id UUID REFERENCES public.profiles(id),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE
);

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 9. PRODUCTS (Catálogo de produtos/serviços)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    price NUMERIC NOT NULL DEFAULT 0,
    sku TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    owner_id UUID REFERENCES public.profiles(id),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 10. DEALS (Negócios/Oportunidades)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    value NUMERIC DEFAULT 0,
    probability INTEGER DEFAULT 0,
    status TEXT,
    priority TEXT DEFAULT 'medium',
    board_id UUID REFERENCES public.boards(id),
    stage_id UUID REFERENCES public.board_stages(id),
    contact_id UUID REFERENCES public.contacts(id),
    client_company_id UUID REFERENCES public.crm_companies(id),
    ai_summary TEXT,
    loss_reason TEXT,
    tags TEXT[] DEFAULT '{}',
    last_stage_change_date TIMESTAMPTZ,
    custom_fields JSONB DEFAULT '{}',
    is_won BOOLEAN NOT NULL DEFAULT FALSE,
    is_lost BOOLEAN NOT NULL DEFAULT FALSE,
    closed_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    owner_id UUID REFERENCES public.profiles(id),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE
);

ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 11. DEAL_ITEMS (Produtos vinculados a deals)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id),
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    price NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE
);

ALTER TABLE public.deal_items ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 12. ACTIVITIES (Atividades: tarefas, ligações, reuniões)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    type TEXT NOT NULL,
    date TIMESTAMPTZ NOT NULL,
    completed BOOLEAN DEFAULT false,
    deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    owner_id UUID REFERENCES public.profiles(id),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE
);

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 13. TAGS (Sistema de tags)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    color TEXT DEFAULT 'bg-gray-500',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    UNIQUE(name, organization_id)
);

ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 14. CUSTOM_FIELD_DEFINITIONS (Campos personalizados)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.custom_field_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT NOT NULL,
    label TEXT NOT NULL,
    type TEXT NOT NULL,
    options TEXT[],
    entity_type TEXT NOT NULL DEFAULT 'deal',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    UNIQUE(key, organization_id)
);

ALTER TABLE public.custom_field_definitions ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 15. LEADS (Para importação de leads)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT,
    company_name TEXT,
    role TEXT,
    source TEXT,
    status TEXT DEFAULT 'NEW',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    converted_to_contact_id UUID REFERENCES public.contacts(id),
    owner_id UUID REFERENCES public.profiles(id),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 16. USER_SETTINGS (Configurações do usuário)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE UNIQUE,
    ai_provider TEXT DEFAULT 'google',
    ai_api_key TEXT,
    ai_model TEXT DEFAULT 'gemini-2.5-flash',
    ai_thinking BOOLEAN DEFAULT true,
    ai_search BOOLEAN DEFAULT true,
    ai_anthropic_caching BOOLEAN DEFAULT false,
    dark_mode BOOLEAN DEFAULT true,
    default_route TEXT DEFAULT '/boards',
    active_board_id UUID REFERENCES public.boards(id),
    inbox_view_mode TEXT DEFAULT 'list',
    onboarding_completed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 17. AI_CONVERSATIONS (Histórico de conversas com IA)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    conversation_key TEXT NOT NULL,
    messages JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, conversation_key)
);

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 18. AI_DECISIONS (Fila de decisões da IA)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    decision_type TEXT NOT NULL,
    priority TEXT DEFAULT 'medium',
    title TEXT NOT NULL,
    description TEXT,
    suggested_action JSONB,
    status TEXT DEFAULT 'pending',
    snoozed_until TIMESTAMPTZ,
    processed_at TIMESTAMPTZ,
    ai_reasoning TEXT,
    confidence_score NUMERIC(3,2),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.ai_decisions ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 19. AI_AUDIO_NOTES (Notas de áudio transcritas)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_audio_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    deal_id UUID REFERENCES public.deals(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
    audio_url TEXT,
    duration_seconds INTEGER,
    transcription TEXT NOT NULL,
    sentiment TEXT,
    next_action JSONB,
    activity_created_id UUID REFERENCES public.activities(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.ai_audio_notes ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 20. ORGANIZATION_INVITES (Convites para novos usuários)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organization_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'vendedor',
    token UUID NOT NULL DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    used_at TIMESTAMPTZ,
    created_by UUID REFERENCES public.profiles(id)
);

ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 21. SYSTEM_NOTIFICATIONS (Notificações do sistema)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.system_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    link TEXT,
    severity TEXT DEFAULT 'medium' CHECK (severity IN ('high', 'medium', 'low')),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.system_notifications ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 22. AI_SUGGESTION_INTERACTIONS (Track AI suggestion actions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_suggestion_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    suggestion_type TEXT NOT NULL CHECK (suggestion_type IN ('UPSELL', 'STALLED', 'BIRTHDAY', 'RESCUE')),
    entity_type TEXT NOT NULL CHECK (entity_type IN ('deal', 'contact')),
    entity_id UUID NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('ACCEPTED', 'DISMISSED', 'SNOOZED')),
    snoozed_until TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(user_id, suggestion_type, entity_id)
);

ALTER TABLE public.ai_suggestion_interactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ai_suggestion_user ON public.ai_suggestion_interactions(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_suggestion_entity ON public.ai_suggestion_interactions(entity_type, entity_id);

-- #############################################################################
-- PARTE 2: TABELAS DE SEGURANÇA
-- #############################################################################

-- -----------------------------------------------------------------------------
-- 23. RATE_LIMITS (Rate limiting para Edge Functions)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rate_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup ON public.rate_limits (identifier, endpoint, created_at DESC);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 24. USER_CONSENTS (LGPD Compliance)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_consents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    consent_type TEXT NOT NULL,
    version TEXT NOT NULL,
    consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address TEXT,
    user_agent TEXT,
    revoked_at TIMESTAMPTZ,
    
    CONSTRAINT valid_consent_type CHECK (
        consent_type IN ('terms', 'privacy', 'marketing', 'analytics', 'data_processing', 'AI_CONSENT')
    )
);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 25. AUDIT_LOGS (Security Monitoring)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    details JSONB DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    severity TEXT NOT NULL DEFAULT 'info',
    
    CONSTRAINT valid_severity CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical'))
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- 26. SECURITY_ALERTS (Sistema de alertas de segurança)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS security_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    alert_type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL DEFAULT 'warning',
    title VARCHAR(255) NOT NULL,
    description TEXT,
    details JSONB,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;

-- #############################################################################
-- PARTE 3: STORAGE BUCKETS
-- #############################################################################

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('audio-notes', 'audio-notes', false)
ON CONFLICT (id) DO NOTHING;

-- #############################################################################
-- PARTE 4: FUNÇÕES AUXILIARES (SIMPLIFICADAS)
-- #############################################################################

-- Verificar se instância foi inicializada
CREATE OR REPLACE FUNCTION public.is_instance_initialized()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN EXISTS (SELECT 1 FROM public.organizations LIMIT 1);
END;
$$;

-- Helper: retorna a única org ativa (ou NULL se não existir)
CREATE OR REPLACE FUNCTION public.get_singleton_organization_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id
    FROM public.organizations
    WHERE deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1;
$$;

-- Estatísticas do Dashboard (simplificado - sem filtro de tenant)
CREATE OR REPLACE FUNCTION public.get_dashboard_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total_deals', (SELECT COUNT(*) FROM public.deals WHERE deleted_at IS NULL),
        'pipeline_value', (SELECT COALESCE(SUM(value), 0) FROM public.deals WHERE is_won = FALSE AND is_lost = FALSE AND deleted_at IS NULL),
        'total_contacts', (SELECT COUNT(*) FROM public.contacts WHERE deleted_at IS NULL),
        'total_companies', (SELECT COUNT(*) FROM public.crm_companies WHERE deleted_at IS NULL),
        'won_deals', (SELECT COUNT(*) FROM public.deals WHERE is_won = TRUE AND deleted_at IS NULL),
        'won_value', (SELECT COALESCE(SUM(value), 0) FROM public.deals WHERE is_won = TRUE AND deleted_at IS NULL),
        'lost_deals', (SELECT COUNT(*) FROM public.deals WHERE is_lost = TRUE AND deleted_at IS NULL),
        'activities_today', (SELECT COUNT(*) FROM public.activities WHERE DATE(date) = CURRENT_DATE AND deleted_at IS NULL)
    ) INTO result;
    
    RETURN result;
END;
$$;

-- Funções para marcar deals como ganho/perdido (simplificadas)
CREATE OR REPLACE FUNCTION public.mark_deal_won(deal_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.deals 
    SET 
        is_won = TRUE,
        is_lost = FALSE,
        closed_at = NOW(),
        updated_at = NOW()
    WHERE id = deal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_deal_lost(deal_id UUID, reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.deals 
    SET 
        is_lost = TRUE,
        is_won = FALSE,
        loss_reason = COALESCE(reason, loss_reason),
        closed_at = NOW(),
        updated_at = NOW()
    WHERE id = deal_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reopen_deal(deal_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    UPDATE public.deals 
    SET 
        is_won = FALSE,
        is_lost = FALSE,
        closed_at = NULL,
        updated_at = NOW()
    WHERE id = deal_id;
END;
$$;

-- Contagem de contatos por estágio
CREATE OR REPLACE FUNCTION get_contact_stage_counts()
RETURNS TABLE (
  stage TEXT,
  count BIGINT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT 
    stage,
    COUNT(*)::BIGINT as count
  FROM contacts
  WHERE deleted_at IS NULL
  GROUP BY stage;
$$;

-- Log de auditoria (simplificado)
CREATE OR REPLACE FUNCTION log_audit_event(
    p_action TEXT,
    p_resource_type TEXT,
    p_resource_id UUID DEFAULT NULL,
    p_details JSONB DEFAULT '{}',
    p_severity TEXT DEFAULT 'info'
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_log_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    INSERT INTO public.audit_logs (
        user_id, action, resource_type, resource_id, details, severity
    ) VALUES (
        v_user_id, p_action, p_resource_type, p_resource_id, p_details, p_severity
    )
    RETURNING id INTO v_log_id;
    
    RETURN v_log_id;
END;
$$;

-- Cleanup rate limits
CREATE OR REPLACE FUNCTION cleanup_rate_limits(older_than_minutes INTEGER DEFAULT 5)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM public.rate_limits
    WHERE created_at < NOW() - (older_than_minutes || ' minutes')::INTERVAL;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$;

-- #############################################################################
-- PARTE 5: TRIGGERS (SIMPLIFICADOS)
-- #############################################################################

-- Trigger: criar profile quando usuário se cadastra
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
DECLARE
    v_org_id uuid;
BEGIN
    v_org_id := (new.raw_user_meta_data->>'organization_id')::uuid;
    IF v_org_id IS NULL THEN
        v_org_id := public.get_singleton_organization_id();
    END IF;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Nenhuma organization encontrada. Rode o setup inicial antes de criar usuários.';
    END IF;

    -- Create Profile
    INSERT INTO public.profiles (id, email, name, avatar, role, organization_id)
    VALUES (
        new.id,
        new.email,
        COALESCE(new.raw_user_meta_data->>'name', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
        new.raw_user_meta_data->>'avatar_url',
        COALESCE(new.raw_user_meta_data->>'role', 'user'),
        v_org_id
    );

    -- Create User Settings (idempotente)
    INSERT INTO public.user_settings (user_id)
    VALUES (new.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Trigger: criar organization_settings automaticamente
CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS trigger AS $$
BEGIN
    INSERT INTO public.organization_settings (organization_id)
    VALUES (new.id)
    ON CONFLICT (organization_id) DO NOTHING;
    RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_org_created ON public.organizations;
CREATE TRIGGER on_org_created
    AFTER INSERT ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization();

-- Cascade soft delete: boards -> deals
CREATE OR REPLACE FUNCTION cascade_soft_delete_deals()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE deals SET deleted_at = NEW.deleted_at WHERE board_id = NEW.id AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cascade_board_delete ON boards;
CREATE TRIGGER cascade_board_delete
    AFTER UPDATE OF deleted_at ON boards
    FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
    EXECUTE FUNCTION cascade_soft_delete_deals();

-- Cascade soft delete: contacts -> activities
CREATE OR REPLACE FUNCTION cascade_soft_delete_activities_by_contact()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE activities SET deleted_at = NEW.deleted_at WHERE contact_id = NEW.id AND deleted_at IS NULL;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cascade_contact_delete ON contacts;
CREATE TRIGGER cascade_contact_delete
    AFTER UPDATE OF deleted_at ON contacts
    FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
    EXECUTE FUNCTION cascade_soft_delete_activities_by_contact();

-- Trigger: prevent duplicate deals (same contact + stage)
CREATE OR REPLACE FUNCTION check_deal_duplicate()
RETURNS TRIGGER AS $$
DECLARE
    existing_deal RECORD;
BEGIN
    IF NEW.contact_id IS NULL THEN
        RETURN NEW;
    END IF;

    -- Fix: Check if deal is OPEN via is_won/is_lost flags
    -- A deal is open if NOT won AND NOT lost
    SELECT d.id, d.title, bs.label as stage_name
    INTO existing_deal
    FROM deals d
    LEFT JOIN board_stages bs ON d.stage_id = bs.id
    WHERE d.contact_id = NEW.contact_id 
      AND d.stage_id = NEW.stage_id
      AND d.deleted_at IS NULL
      AND d.is_won = FALSE 
      AND d.is_lost = FALSE
      AND NEW.is_won = FALSE
      AND NEW.is_lost = FALSE
      AND (TG_OP = 'INSERT' OR d.id != NEW.id)
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Já existe um negócio para este contato no estágio "%". Mova o negócio existente ou escolha outro estágio.', 
            COALESCE(existing_deal.stage_name, 'desconhecido')
        USING ERRCODE = 'unique_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS check_deal_duplicate_trigger ON deals;
CREATE TRIGGER check_deal_duplicate_trigger
    BEFORE INSERT OR UPDATE ON deals
    FOR EACH ROW
    EXECUTE FUNCTION check_deal_duplicate();

-- #############################################################################
-- PARTE 6: ROW LEVEL SECURITY POLICIES (SIMPLIFICADAS)
-- #############################################################################

-- ORGANIZATIONS (acesso livre para authenticated)
DROP POLICY IF EXISTS "authenticated_access" ON public.organizations;
CREATE POLICY "authenticated_access" ON public.organizations
    FOR ALL TO authenticated
    USING (deleted_at IS NULL)
    WITH CHECK (true);

-- PROFILES
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
CREATE POLICY "profiles_select" ON public.profiles
    FOR SELECT TO authenticated
    USING (true);

DROP POLICY IF EXISTS "profiles_update" ON public.profiles;
CREATE POLICY "profiles_update" ON public.profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- USER SETTINGS
DROP POLICY IF EXISTS "user_settings_isolate" ON public.user_settings;
CREATE POLICY "user_settings_isolate" ON public.user_settings
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());


-- =============================================================================
-- PART 2: COCKPIT FEATURES (Originally 20251208000000_cockpit_features.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. DEAL_NOTES (Notas por Deal)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.deal_notes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_deal_notes_deal ON public.deal_notes(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_notes_created ON public.deal_notes(created_at DESC);

-- RLS: Todos usuários autenticados podem ler/escrever (single-tenant)
DROP POLICY IF EXISTS "deal_notes_access" ON public.deal_notes;
CREATE POLICY "deal_notes_access" ON public.deal_notes
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 2. DEAL_FILES (Arquivos por Deal)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

ALTER TABLE public.deal_files ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_deal_files_deal ON public.deal_files(deal_id);

-- RLS
DROP POLICY IF EXISTS "deal_files_access" ON public.deal_files;
CREATE POLICY "deal_files_access" ON public.deal_files
    FOR ALL TO authenticated
    USING (true)
    WITH CHECK (true);

-- -----------------------------------------------------------------------------
-- 3. STORAGE BUCKET FOR DEAL FILES
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('deal-files', 'deal-files', false, 10485760) -- 10MB limit
ON CONFLICT (id) DO UPDATE SET file_size_limit = 10485760;

-- Storage policies
DROP POLICY IF EXISTS "deal_files_upload" ON storage.objects;
CREATE POLICY "deal_files_upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'deal-files');

DROP POLICY IF EXISTS "deal_files_read" ON storage.objects;
CREATE POLICY "deal_files_read" ON storage.objects
    FOR SELECT TO authenticated
    USING (bucket_id = 'deal-files');

DROP POLICY IF EXISTS "deal_files_delete" ON storage.objects;
CREATE POLICY "deal_files_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'deal-files');

-- -----------------------------------------------------------------------------
-- 4. QUICK_SCRIPTS (Templates de Scripts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quick_scripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('followup', 'objection', 'closing', 'intro', 'rescue', 'other')),
    template TEXT NOT NULL,
    icon TEXT DEFAULT 'MessageSquare',
    is_system BOOLEAN DEFAULT false, -- Scripts do sistema (não podem ser deletados)
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.quick_scripts ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_quick_scripts_user ON public.quick_scripts(user_id);
CREATE INDEX IF NOT EXISTS idx_quick_scripts_category ON public.quick_scripts(category);

-- RLS: Ver scripts do sistema + próprios, criar/editar/deletar apenas próprios
DROP POLICY IF EXISTS "quick_scripts_select" ON public.quick_scripts;
CREATE POLICY "quick_scripts_select" ON public.quick_scripts
    FOR SELECT TO authenticated
    USING (is_system = true OR user_id = auth.uid());

DROP POLICY IF EXISTS "quick_scripts_insert" ON public.quick_scripts;
CREATE POLICY "quick_scripts_insert" ON public.quick_scripts
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() AND is_system = false);

DROP POLICY IF EXISTS "quick_scripts_update" ON public.quick_scripts;
CREATE POLICY "quick_scripts_update" ON public.quick_scripts
    FOR UPDATE TO authenticated
    USING (user_id = auth.uid() AND is_system = false)
    WITH CHECK (user_id = auth.uid() AND is_system = false);

DROP POLICY IF EXISTS "quick_scripts_delete" ON public.quick_scripts;
CREATE POLICY "quick_scripts_delete" ON public.quick_scripts
    FOR DELETE TO authenticated
    USING (user_id = auth.uid() AND is_system = false);

-- -----------------------------------------------------------------------------
-- 5. SEED: Default System Scripts
-- -----------------------------------------------------------------------------
INSERT INTO public.quick_scripts (title, category, template, icon, is_system, user_id) VALUES
(
    'Follow-up Amigável',
    'followup',
    'Olá {nome}! 👋

Tudo bem? Estou passando para ver como estão as coisas por aí.

Conseguiu avaliar nossa última conversa? Fico à disposição para tirar qualquer dúvida!

Abraço!',
    'MessageCircle',
    true,
    NULL
),
(
    'Resposta a Objeção de Preço',
    'objection',
    'Entendo sua preocupação com o investimento, {nome}.

O que muitos dos nossos clientes perceberam é que o retorno vem em [X meses]. 

Posso te mostrar alguns cases de sucesso similares ao seu negócio?',
    'AlertCircle',
    true,
    NULL
),
(
    'Fechamento Suave',
    'closing',
    '{nome}, com base no que conversamos:

✅ [Benefício 1]
✅ [Benefício 2]  
✅ [Benefício 3]

Podemos dar o próximo passo? O que falta para fecharmos?',
    'Target',
    true,
    NULL
),
(
    'Primeira Abordagem',
    'intro',
    'Olá {nome}! 👋

Vi que você [contexto de como chegou]. 

Sou especialista em [área] e ajudo empresas como a [empresa] a [resultado].

Podemos bater um papo de 15 minutos essa semana?',
    'Sparkles',
    true,
    NULL
),
(
    'Resgate de Deal Parado',
    'rescue',
    'Oi {nome}, quanto tempo! 😊

Estava revisando meus contatos e lembrei da nossa última conversa sobre [assunto].

Sei que as coisas mudam, mas queria saber se faz sentido retomar de onde paramos. O que acha?',
    'RefreshCw',
    true,
    NULL
)
ON CONFLICT DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. TRIGGER: Auto-update updated_at
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_deal_notes_updated_at ON public.deal_notes;
CREATE TRIGGER update_deal_notes_updated_at
    BEFORE UPDATE ON public.deal_notes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_quick_scripts_updated_at ON public.quick_scripts;
CREATE TRIGGER update_quick_scripts_updated_at
    BEFORE UPDATE ON public.quick_scripts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- =============================================================================
-- PART 3: AI KEY SEPARATION (Originally 20251208193000_separate_ai_keys.sql)
-- =============================================================================

-- Add separate API key columns for each provider
ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS ai_google_key TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ai_openai_key TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS ai_anthropic_key TEXT DEFAULT NULL;

-- Keep ai_api_key as a computed/current key for backward compatibility
COMMENT ON COLUMN public.user_settings.ai_api_key IS 'Legacy column - use ai_<provider>_key instead';
COMMENT ON COLUMN public.user_settings.ai_google_key IS 'Google/Gemini API key';
COMMENT ON COLUMN public.user_settings.ai_openai_key IS 'OpenAI API key';
COMMENT ON COLUMN public.user_settings.ai_anthropic_key IS 'Anthropic/Claude API key';


-- =============================================================================
-- PART 4: MORE SYSTEM SCRIPTS (Originally 20251208220000_more_system_scripts.sql)
-- =============================================================================

-- Additional system scripts for better coverage across sales scenarios
INSERT INTO public.quick_scripts (title, category, template, icon, is_system, user_id) VALUES

-- ========== FOLLOW-UP ==========
(
    'Follow-up de Reunião',
    'followup',
    'Oi {nome}! 👋

Foi ótimo falar com você hoje sobre [assunto da reunião].

Conforme combinamos, seguem os próximos passos:
1. [Item 1]
2. [Item 2]

Qualquer dúvida, estou à disposição!',
    'Calendar',
    true,
    NULL
),
(
    'Confirmação de Agendamento',
    'followup',
    'Olá {nome}! 📅

Confirmando nossa reunião:

📆 Data: [dia/mês]
⏰ Horário: [horário]
📍 Local: [link/endereço]

Precisa remarcar? Me avise com antecedência!

Te espero lá!',
    'Clock',
    true,
    NULL
),
(
    'Follow-up Pós-Proposta',
    'followup',
    '{nome}, tudo certo?

Passando para saber se teve a chance de analisar a proposta que enviei.

Ficou com alguma dúvida ou quer ajustar algum ponto? Fico à disposição para conversarmos!',
    'FileText',
    true,
    NULL
),

-- ========== OBJEÇÕES ==========
(
    'Objeção: Preciso Pensar',
    'objection',
    'Entendo perfeitamente, {nome}. 

Me conta: qual é o principal ponto que você gostaria de avaliar melhor?

Assim posso te ajudar com mais informações para sua decisão.',
    'Brain',
    true,
    NULL
),
(
    'Objeção: Não é o Momento',
    'objection',
    'Compreendo, {nome}. O timing é importante mesmo.

Só para eu entender melhor: o que mudaria para ser o momento ideal? 

Assim consigo te ajudar melhor quando fizer sentido.',
    'Clock',
    true,
    NULL
),
(
    'Objeção: Já Tenho Fornecedor',
    'objection',
    'Faz sentido, {nome}. Ter um fornecedor de confiança é importante.

A maioria dos nossos clientes também tinha quando nos conheceram. O que eles descobriram foi [diferencial].

Posso te mostrar como complementamos o que você já tem?',
    'Users',
    true,
    NULL
),

-- ========== FECHAMENTO ==========
(
    'Fechamento Urgente',
    'closing',
    '{nome}, lembrete rápido: 

Nossa condição especial de [oferta] vai até [data].

Depois disso, o investimento volta ao valor normal de [valor].

Quer garantir antes que acabe?',
    'Zap',
    true,
    NULL
),
(
    'Fechamento por Escassez',
    'closing',
    '{nome}, preciso ser sincero:

Temos apenas [X vagas/unidades] disponíveis este mês, e já estamos com [Y] confirmadas.

Consigo reservar uma para você se confirmarmos até [data]. Faz sentido?',
    'AlertTriangle',
    true,
    NULL
),

-- ========== APRESENTAÇÃO ==========
(
    'Pedido de Indicação',
    'intro',
    'Oi {nome}! 

Estava pensando: você conhece alguém que também poderia se beneficiar de [solução]?

Adoraria ajudar outros profissionais como você. Se tiver alguém em mente, me avisa! 🙏',
    'UserPlus',
    true,
    NULL
),
(
    'Conexão via LinkedIn',
    'intro',
    'Olá {nome}!

Vi seu perfil no LinkedIn e me identifiquei com [algo específico].

Trabalho com [área] e ajudo [público] a [resultado]. 

Podemos conectar? Adoraria trocar experiências!',
    'Linkedin',
    true,
    NULL
),

-- ========== RESGATE ==========
(
    'Reativação de Cliente Antigo',
    'rescue',
    'Oi {nome}! Saudades! 😊

Faz um tempo que não conversamos e queria saber como estão as coisas por aí.

Temos algumas novidades que podem te interessar: [novidade].

Bora colocar o papo em dia?',
    'Heart',
    true,
    NULL
),
(
    'Tentativa Final',
    'rescue',
    '{nome}, 

Tentei te contatar algumas vezes sem sucesso.

Entendo que as coisas podem ter mudado. Se não fizer mais sentido, tudo bem!

Só me avisa se devo parar ou se prefere retomar mais pra frente. 🙏',
    'Flag',
    true,
    NULL
)

ON CONFLICT DO NOTHING;


-- =============================================================================
-- PART 5: BOARD ARCHIVE FEATURES (Originally 20251209140000_board_archive_features.sql)
-- =============================================================================

-- 1. Add Explicit Won/Lost Stage IDs
ALTER TABLE boards ADD COLUMN IF NOT EXISTS won_stage_id UUID REFERENCES board_stages(id);
ALTER TABLE boards ADD COLUMN IF NOT EXISTS lost_stage_id UUID REFERENCES board_stages(id);

-- 2. Add Stay In Stage (Archive) Flags
ALTER TABLE boards ADD COLUMN IF NOT EXISTS won_stay_in_stage BOOLEAN DEFAULT FALSE;
ALTER TABLE boards ADD COLUMN IF NOT EXISTS lost_stay_in_stage BOOLEAN DEFAULT FALSE;

-- Trigger: Sync email from auth.users to public.profiles
CREATE OR REPLACE FUNCTION public.handle_user_email_update()
RETURNS trigger AS $$
BEGIN
    UPDATE public.profiles
    SET 
        email = NEW.email,
        updated_at = NOW()
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW
    WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.handle_user_email_update();

-- RLS Policies for Boards (Added via fix)
CREATE POLICY "Enable read access for authenticated users" ON public.boards FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert access for authenticated users" ON public.boards FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Enable update access for authenticated users" ON public.boards FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Enable delete access for authenticated users" ON public.boards FOR DELETE TO authenticated USING (true);

-- RLS Policies for Board Stages (Added via fix)
CREATE POLICY "Enable read access for authenticated users" ON public.board_stages FOR SELECT TO authenticated USING (true);
CREATE POLICY "Enable insert access for authenticated users" ON public.board_stages FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Enable update access for authenticated users" ON public.board_stages FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Enable delete access for authenticated users" ON public.board_stages FOR DELETE TO authenticated USING (true);

-- RLS Policies for Core Tables (Added via audit fix)
-- Lifecycle Stages
CREATE POLICY "Enable all access for authenticated users" ON public.lifecycle_stages FOR ALL TO authenticated USING (true);

-- CRM Companies
CREATE POLICY "Enable all access for authenticated users" ON public.crm_companies FOR ALL TO authenticated USING (true);

-- Contacts
CREATE POLICY "Enable all access for authenticated users" ON public.contacts FOR ALL TO authenticated USING (true);

-- Products
CREATE POLICY "Enable all access for authenticated users" ON public.products FOR ALL TO authenticated USING (true);

-- Deals
CREATE POLICY "Enable all access for authenticated users" ON public.deals FOR ALL TO authenticated USING (true);

-- Deal Items
CREATE POLICY "Enable all access for authenticated users" ON public.deal_items FOR ALL TO authenticated USING (true);

-- Activities
CREATE POLICY "Enable all access for authenticated users" ON public.activities FOR ALL TO authenticated USING (true);

-- Tags
CREATE POLICY "Enable all access for authenticated users" ON public.tags FOR ALL TO authenticated USING (true);

-- Custom Field Definitions
CREATE POLICY "Enable all access for authenticated users" ON public.custom_field_definitions FOR ALL TO authenticated USING (true);

-- Leads
CREATE POLICY "Enable all access for authenticated users" ON public.leads FOR ALL TO authenticated USING (true);

-- AI Tables
CREATE POLICY "Enable all access for authenticated users" ON public.ai_conversations FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all access for authenticated users" ON public.ai_decisions FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all access for authenticated users" ON public.ai_audio_notes FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all access for authenticated users" ON public.ai_suggestion_interactions FOR ALL TO authenticated USING (true);

-- System Tables
-- Organization Invites (hardened)
DROP POLICY IF EXISTS "Enable all access for authenticated users" ON public.organization_invites;
DROP POLICY IF EXISTS "Allow public to validate invite tokens" ON public.organization_invites;

DROP POLICY IF EXISTS "Admins can manage organization invites" ON public.organization_invites;
CREATE POLICY "Admins can manage organization invites"
    ON public.organization_invites
    FOR ALL
    TO authenticated
    USING (
        auth.uid() IN (
            SELECT id FROM public.profiles
            WHERE organization_id = organization_invites.organization_id
            AND role = 'admin'
        )
    )
    WITH CHECK (
        auth.uid() IN (
            SELECT id FROM public.profiles
            WHERE organization_id = organization_invites.organization_id
            AND role = 'admin'
        )
    );

DROP POLICY IF EXISTS "Members can view organization invites" ON public.organization_invites;
CREATE POLICY "Members can view organization invites"
    ON public.organization_invites
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() IN (
            SELECT id FROM public.profiles
            WHERE organization_id = organization_invites.organization_id
        )
    );

-- Organization Settings
DROP POLICY IF EXISTS "Admins can manage org settings" ON public.organization_settings;
CREATE POLICY "Admins can manage org settings"
        ON public.organization_settings
        FOR ALL
        TO authenticated
        USING (
                auth.uid() IN (
                        SELECT id FROM public.profiles 
                        WHERE organization_id = organization_settings.organization_id 
                        AND role = 'admin'
                )
        )
        WITH CHECK (
                auth.uid() IN (
                        SELECT id FROM public.profiles 
                        WHERE organization_id = organization_settings.organization_id 
                        AND role = 'admin'
                )
        );

DROP POLICY IF EXISTS "Members can view org settings" ON public.organization_settings;
CREATE POLICY "Members can view org settings"
        ON public.organization_settings
        FOR SELECT
        TO authenticated
        USING (
                auth.uid() IN (
                        SELECT id FROM public.profiles 
                        WHERE organization_id = organization_settings.organization_id
                )
        );

CREATE POLICY "Enable all access for authenticated users" ON public.system_notifications FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all access for authenticated users" ON public.rate_limits FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all access for authenticated users" ON public.user_consents FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all access for authenticated users" ON public.audit_logs FOR ALL TO authenticated USING (true);
CREATE POLICY "Enable all access for authenticated users" ON security_alerts FOR ALL TO authenticated USING (true);

-- Storage Policies for Avatars (Added via audit fix)
DROP POLICY IF EXISTS "avatar_upload" ON storage.objects;
CREATE POLICY "avatar_upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatar_select" ON storage.objects;
CREATE POLICY "avatar_select" ON storage.objects
    FOR SELECT TO public
    USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatar_update" ON storage.objects;
CREATE POLICY "avatar_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatar_delete" ON storage.objects;
CREATE POLICY "avatar_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (bucket_id = 'avatars');

-- =============================================================================
-- PART 6: REALTIME CONFIGURATION
-- =============================================================================

-- Enable Realtime for all CRM tables
-- This allows real-time updates across multiple users
DO $$
BEGIN
    -- Add tables to realtime publication if not already added
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'deals') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE deals;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'activities') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE activities;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'contacts') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE contacts;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'crm_companies') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE crm_companies;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'board_stages') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE board_stages;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'boards') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE boards;
    END IF;
END $$;

-- =============================================================================
-- PART 7: FUNCTION GRANTS
-- =============================================================================

GRANT EXECUTE ON FUNCTION public.is_instance_initialized TO anon;
GRANT EXECUTE ON FUNCTION public.is_instance_initialized TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_deal_won TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_deal_lost TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_deal TO authenticated;
GRANT EXECUTE ON FUNCTION log_audit_event TO authenticated;
GRANT EXECUTE ON FUNCTION get_contact_stage_counts() TO authenticated;
