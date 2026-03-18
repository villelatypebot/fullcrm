import { NextResponse } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { normalizePhoneE164 } from '@/lib/phone';

/**
 * Webhook receiver for the FullHouse Reservation system.
 *
 * POST /api/webhooks/reservations
 *
 * Receives events from the reservation system webhooks:
 * - reservation.confirmed: Sync contact + create activity
 * - reservation.cancelled: Update activity
 * - reservation.no_show: Update activity
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  // Validate HMAC signature if present
  const signature = request.headers.get('x-fullhouse-signature');
  // TODO: Validate signature with webhook secret when configured

  const { event, data } = body;
  if (!event || !data) {
    return NextResponse.json({ error: 'Missing event or data' }, { status: 400 });
  }

  console.log('[reservation-webhook] Received event:', event);

  const supabase = createStaticAdminClient();

  try {
    switch (event) {
      case 'reservation.confirmed':
      case 'reservation.cancelled':
      case 'reservation.no_show':
      case 'reservation.seated': {
        await handleReservationEvent(supabase, event, data);
        break;
      }
      default:
        console.log('[reservation-webhook] Unhandled event:', event);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[reservation-webhook] Error:', err);
    return NextResponse.json({ ok: true }); // Return 200 to avoid retries
  }
}

async function handleReservationEvent(
  supabase: ReturnType<typeof createStaticAdminClient>,
  event: string,
  data: Record<string, unknown>,
) {
  const customer = data.customer as { name?: string; email?: string; phone?: string } | undefined;
  if (!customer?.phone) {
    console.log('[reservation-webhook] No customer phone, skipping contact sync');
    return;
  }

  const phone = normalizePhoneE164(customer.phone);
  if (!phone) return;

  // Find organization that has reservation integration configured
  // For now, we search all organizations for a contact with this phone
  const { data: existingContacts } = await supabase
    .from('contacts')
    .select('id, organization_id, name')
    .eq('phone', phone)
    .limit(1);

  let contactId: string | undefined;
  let organizationId: string | undefined;

  if (existingContacts && existingContacts.length > 0) {
    contactId = existingContacts[0].id;
    organizationId = existingContacts[0].organization_id;

    // Update existing contact with reservation context on confirmed bookings
    if (event === 'reservation.confirmed') {
      await supabase
        .from('contacts')
        .update({
          temperature: 'warm',
          stage: 'CUSTOMER',
          last_interaction: new Date().toISOString(),
        })
        .eq('id', contactId);
      console.log('[reservation-webhook] Updated existing contact to CUSTOMER and warm:', contactId);
    }
  } else if (event === 'reservation.confirmed') {
    // Try to find the org that has reservation integration
    const { data: orgs } = await supabase
      .from('organization_settings')
      .select('organization_id')
      .not('reservation_supabase_url', 'is', null)
      .limit(1);

    if (orgs && orgs.length > 0) {
      organizationId = orgs[0].organization_id;

      // Create new contact with warm temperature (they're booking, so they're interested)
      const { data: newContact } = await supabase
        .from('contacts')
        .insert({
          organization_id: organizationId,
          name: customer.name || 'Cliente Reserva',
          phone,
          email: customer.email || null,
          status: 'ACTIVE',
          stage: 'CUSTOMER',
          source: 'WEBSITE',
          temperature: 'warm',
        })
        .select('id')
        .single();

      if (newContact) {
        contactId = newContact.id;
        console.log('[reservation-webhook] Created new contact:', contactId);
      }
    }
  }

  if (!contactId || !organizationId) return;

  // Create activity for the reservation event
  const confirmationCode = data.confirmation_code as string || '';
  const date = data.date as string || '';
  const time = data.time as string || '';
  const pax = data.pax as number || 0;
  const status = data.status as string || '';

  const eventTitles: Record<string, string> = {
    'reservation.confirmed': `Reserva confirmada #${confirmationCode}`,
    'reservation.cancelled': `Reserva cancelada #${confirmationCode}`,
    'reservation.no_show': `No-show na reserva #${confirmationCode}`,
    'reservation.seated': `Cliente sentado - Reserva #${confirmationCode}`,
  };

  await supabase.from('activities').insert({
    organization_id: organizationId,
    contact_id: contactId,
    title: eventTitles[event] || `Reserva: ${event}`,
    description: `Data: ${date} às ${time}\nPessoas: ${pax}\nStatus: ${status}\nCódigo: ${confirmationCode}`,
    type: 'note',
    date: new Date().toISOString(),
    completed: event !== 'reservation.confirmed',
  });

  console.log('[reservation-webhook] Activity created for contact:', contactId, event);
}
