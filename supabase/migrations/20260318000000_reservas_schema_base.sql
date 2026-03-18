-- ================================================================
-- Full House Reservas — Migration Completa
-- Cole este SQL no SQL Editor do Supabase e clique em "Run"
-- URL: https://supabase.com/dashboard/project/bqroijjherbnhsdsnaor/sql/new
-- ================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS units (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  address TEXT,
  phone TEXT,
  image_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  capacity INT NOT NULL DEFAULT 50,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS time_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time TIME NOT NULL,
  close_time TIME NOT NULL,
  slot_interval_minutes INT DEFAULT 30,
  max_pax_per_slot INT NOT NULL DEFAULT 50,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS reservation_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID UNIQUE REFERENCES units(id) ON DELETE CASCADE,
  min_advance_hours INT DEFAULT 2,
  max_advance_days INT DEFAULT 60,
  tolerance_minutes INT DEFAULT 30,
  min_pax INT DEFAULT 1,
  max_pax INT DEFAULT 20,
  custom_fields JSONB DEFAULT '[]',
  cancellation_policy TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS date_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
  block_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id),
  environment_id UUID REFERENCES environments(id),
  customer_id UUID REFERENCES customers(id),
  reservation_date DATE NOT NULL,
  reservation_time TIME NOT NULL,
  pax INT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','confirmed','seated','no_show','cancelled')),
  custom_data JSONB DEFAULT '{}',
  confirmation_code TEXT UNIQUE,
  notes TEXT,
  source TEXT DEFAULT 'online',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE OR REPLACE FUNCTION generate_confirmation_code()
RETURNS TEXT AS $$
DECLARE
  chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code TEXT := 'FH-';
  i INT;
BEGIN
  FOR i IN 1..6 LOOP
    code := code || substr(chars, floor(random() * length(chars) + 1)::int, 1);
  END LOOP;
  RETURN code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_confirmation_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.confirmation_code IS NULL THEN
    LOOP
      NEW.confirmation_code := generate_confirmation_code();
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM reservations WHERE confirmation_code = NEW.confirmation_code
      );
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_set_confirmation_code ON reservations;
CREATE TRIGGER tr_set_confirmation_code
  BEFORE INSERT ON reservations
  FOR EACH ROW EXECUTE FUNCTION set_confirmation_code();

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_reservations_updated_at ON reservations;
CREATE TRIGGER tr_reservations_updated_at
  BEFORE UPDATE ON reservations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT[] NOT NULL DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  last_status INT,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id UUID REFERENCES webhooks(id) ON DELETE CASCADE,
  reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  payload JSONB,
  response_status INT,
  response_body TEXT,
  triggered_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS follow_up_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id UUID REFERENCES units(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  trigger_event TEXT NOT NULL,
  offset_minutes INT NOT NULL DEFAULT 0,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  message_template TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS reminder_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_id UUID REFERENCES reservations(id) ON DELETE CASCADE,
  rule_id UUID REFERENCES follow_up_rules(id) ON DELETE CASCADE,
  channel TEXT,
  status TEXT DEFAULT 'pending',
  sent_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT DEFAULT 'operator' CHECK (role IN ('admin','manager','operator')),
  unit_ids UUID[],
  created_at TIMESTAMPTZ DEFAULT now()
);

-- SEED
INSERT INTO units (name, slug, address, phone) VALUES
  ('Full House Boa Vista', 'boa-vista', 'Rua da Boa Vista, 123 - Niterói, RJ', '(21) 99000-0001'),
  ('Full House Colubandê', 'colubande', 'Av. Colubandê, 456 - São Gonçalo, RJ', '(21) 99000-0002'),
  ('Full House Araruama', 'araruama', 'Rua Principal, 789 - Araruama, RJ', '(22) 99000-0003'),
  ('Full House Niterói', 'niteroi', 'Rua Icaraí, 321 - Niterói, RJ', '(21) 99000-0004')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO environments (unit_id, name, capacity)
SELECT id, 'Salão Principal', 80 FROM units
ON CONFLICT DO NOTHING;

INSERT INTO environments (unit_id, name, capacity)
SELECT id, 'Espaço Família', 40 FROM units
ON CONFLICT DO NOTHING;

INSERT INTO time_slots (unit_id, day_of_week, open_time, close_time, slot_interval_minutes, max_pax_per_slot)
SELECT u.id, d.day, '18:00'::time, '22:00'::time, 30, 60
FROM units u
CROSS JOIN (VALUES (5), (6), (0)) AS d(day)
ON CONFLICT DO NOTHING;

INSERT INTO reservation_rules (unit_id, min_advance_hours, max_advance_days, tolerance_minutes, min_pax, max_pax, cancellation_policy)
SELECT id, 2, 60, 30, 1, 20, 'A reserva pode ser cancelada com até 4 horas de antecedência.'
FROM units
ON CONFLICT (unit_id) DO NOTHING;

-- RLS
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE environments ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE date_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE follow_up_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminder_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_units') THEN
    CREATE POLICY "public_read_units" ON units FOR SELECT USING (is_active = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_environments') THEN
    CREATE POLICY "public_read_environments" ON environments FOR SELECT USING (is_active = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_time_slots') THEN
    CREATE POLICY "public_read_time_slots" ON time_slots FOR SELECT USING (is_active = true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_reservation_rules') THEN
    CREATE POLICY "public_read_reservation_rules" ON reservation_rules FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_insert_customers') THEN
    CREATE POLICY "public_insert_customers" ON customers FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_customers') THEN
    CREATE POLICY "public_read_customers" ON customers FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_insert_reservations') THEN
    CREATE POLICY "public_insert_reservations" ON reservations FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'public_read_reservations') THEN
    CREATE POLICY "public_read_reservations" ON reservations FOR SELECT USING (true);
  END IF;
  -- Service full access
  CREATE POLICY "service_all_units" ON units FOR ALL USING (true); EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Simpler approach for service policies
DO $$ 
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['units','environments','time_slots','reservation_rules','date_blocks','reservations','customers','webhooks','webhook_logs','follow_up_rules','reminder_logs','admin_users'] LOOP
    BEGIN
      EXECUTE format('CREATE POLICY "svc_all_%s" ON %I FOR ALL USING (true)', tbl, tbl);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations(reservation_date);
CREATE INDEX IF NOT EXISTS idx_reservations_unit_date ON reservations(unit_id, reservation_date);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations(status);
CREATE INDEX IF NOT EXISTS idx_reservations_code ON reservations(confirmation_code);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id);

-- Verify
SELECT 'Migration complete!' as status, count(*) as units_count FROM units;
-- ================================================================
-- Migration 002: User role update + Push Subscriptions
-- ================================================================

-- 1. Update admin_users role constraint to include 'viewer'
ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check 
  CHECK (role IN ('admin','manager','operator','viewer'));

-- 2. Push subscriptions table for PWA notifications
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES admin_users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "svc_all_push_subscriptions" ON push_subscriptions FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_push_subs_admin_user ON push_subscriptions(admin_user_id);

SELECT 'Migration 002 complete!' as status;
-- ================================================================
-- Migration 003: Ajustes para Environments e novas funcionalidades
-- Cole no SQL Editor: https://supabase.com/dashboard/project/bqroijjherbnhsdsnaor/sql/new
-- ================================================================

-- 1. Adicionar colunas que faltam na tabela environments
ALTER TABLE environments
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 2. Renomear capacity -> max_capacity para consistência
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'environments' AND column_name = 'capacity'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'environments' AND column_name = 'max_capacity'
  ) THEN
    ALTER TABLE environments RENAME COLUMN capacity TO max_capacity;
  END IF;
END $$;

-- 3. Garantir RLS desabilitado para acesso admin (as tabelas já devem estar sem RLS)
-- Se precisar habilitar RLS no futuro, adicione policies aqui.
