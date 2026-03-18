-- ================================================================
-- CRM Database Unification & Triggers
-- ================================================================

-- 1. Bridge the isolated Units directly to the CRM Organizations
ALTER TABLE units ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- 2. Inject CRM contact mapping into Reservations natively
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_reservations_contact_id ON reservations(contact_id);

-- 3. Trigger that auto-syncs or creates the Contact Lead on the CRM when a reservation becomes confirmed
CREATE OR REPLACE FUNCTION sync_reservation_to_crm_contact() RETURNS TRIGGER AS $$
DECLARE
  v_phone TEXT;
  v_org_id UUID;
  v_name TEXT;
  v_contact_id UUID;
BEGIN
  -- Fetch the customer and the organization details linked to the event
  SELECT phone, name INTO v_phone, v_name FROM customers WHERE id = NEW.customer_id;
  SELECT organization_id INTO v_org_id FROM units WHERE id = NEW.unit_id;
  
  IF v_org_id IS NOT NULL AND v_phone IS NOT NULL THEN
     -- Check if this Contact already exists via the WhatsApp / CRM platform
     SELECT id INTO v_contact_id FROM contacts WHERE phone = v_phone AND organization_id = v_org_id LIMIT 1;
     
     IF v_contact_id IS NULL THEN
        INSERT INTO contacts (organization_id, phone, name, stage, temperature, lead_source)
        VALUES (v_org_id, v_phone, v_name, 'CUSTOMER', 'warm', 'reservation_system')
        RETURNING id INTO v_contact_id;
     ELSE
        UPDATE contacts 
        SET stage = 'CUSTOMER', 
            temperature = 'warm', 
            last_interaction = now() 
        WHERE id = v_contact_id;
     END IF;
     
     NEW.contact_id := v_contact_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_sync_reservation_contact ON reservations;
CREATE TRIGGER tr_sync_reservation_contact
BEFORE INSERT OR UPDATE OF status ON reservations
FOR EACH ROW
WHEN (NEW.status = 'confirmed')
EXECUTE FUNCTION sync_reservation_to_crm_contact();
