/**
 * Sync reservations from the Agendamentos system into CRM contacts.
 *
 * GET /api/reservations/sync
 *
 * Pulls all reservations with customer data from the reservation Supabase
 * and creates/updates CRM contacts for each. Also stores reservation data
 * in the contact's WhatsApp memory so the AI knows about it.
 *
 * Can be called manually or via Vercel Cron.
 */
import { NextResponse } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { createReservationClient } from '@/lib/reservations/client';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

export async function GET() {
  const supabase = createStaticAdminClient();
  const orgId = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';

  // Get reservation Supabase credentials
  const { data: settings } = await supabase
    .from('organization_settings')
    .select('reservation_supabase_url, reservation_supabase_key')
    .eq('organization_id', orgId)
    .single();

  if (!settings?.reservation_supabase_url || !settings?.reservation_supabase_key) {
    return NextResponse.json({ error: 'No reservation credentials' }, { status: 400 });
  }

  const resSupabase = createClient(
    settings.reservation_supabase_url,
    settings.reservation_supabase_key,
  );

  try {
    // Fetch all reservations with customer data
    const { data: reservations, error: resErr } = await resSupabase
      .from('reservations')
      .select('*, customers(name, phone, email), units(name, slug)')
      .in('status', ['confirmed', 'pending', 'seated'])
      .order('created_at', { ascending: false })
      .limit(100);

    if (resErr) throw resErr;
    if (!reservations || reservations.length === 0) {
      return NextResponse.json({ ok: true, synced: 0, message: 'No reservations to sync' });
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const reservation of reservations) {
      const customer = reservation.customers as { name: string; phone: string; email: string | null } | null;
      const unit = reservation.units as { name: string; slug: string } | null;

      if (!customer?.phone) {
        skipped++;
        continue;
      }

      // Normalize phone: keep only digits
      const digits = customer.phone.replace(/\D/g, '');
      // Try to find with full number, or just last 8-9 digits
      const phoneLast8 = digits.slice(-8);

      // Search for existing contact by phone (partial match)
      const { data: existingContacts } = await supabase
        .from('contacts')
        .select('id, phone')
        .eq('organization_id', orgId)
        .or(`phone.like.%${phoneLast8}%`)
        .limit(1);

      let contactId: string;

      // Build reservation tag for notes field (parsed by ContactsList UI)
      const reservationTag = `[RESERVA:${reservation.confirmation_code}|${reservation.reservation_date}|${(reservation.reservation_time || '').substring(0, 5)}|${reservation.pax}|${unit?.name || ''}|${reservation.status}]`;

      if (existingContacts && existingContacts.length > 0) {
        contactId = existingContacts[0].id;

        // Update contact with reservation info
        await supabase
          .from('contacts')
          .update({
            temperature: 'warm',
            stage: 'CUSTOMER',
            last_interaction: new Date().toISOString(),
            notes: reservationTag,
            ...(customer.email && !existingContacts[0].phone ? { email: customer.email } : {}),
          })
          .eq('id', contactId);

        updated++;
      } else {
        // Create new contact
        const fullPhone = digits.length <= 11 ? `55${digits}` : digits;
        const { data: newContact, error: createErr } = await supabase
          .from('contacts')
          .insert({
            organization_id: orgId,
            name: customer.name || 'Cliente Reserva',
            phone: fullPhone,
            email: customer.email || null,
            status: 'ACTIVE',
            stage: 'CUSTOMER',
            source: 'WEBSITE',
            temperature: 'warm',
            notes: reservationTag,
          })
          .select('id')
          .single();

        if (createErr || !newContact) {
          console.error('[reservation-sync] Failed to create contact:', createErr);
          skipped++;
          continue;
        }

        contactId = newContact.id;
        created++;
      }

      // Find WhatsApp conversation for this contact to store reservation memory
      const { data: conversation } = await supabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('contact_id', contactId)
        .limit(1)
        .maybeSingle();

      if (conversation) {
        // Store reservation as memory so AI knows about it
        const memoryKey = `reserva_${reservation.confirmation_code}`;
        const memoryValue = `Reserva ${reservation.confirmation_code}: ${reservation.reservation_date} às ${reservation.reservation_time}, ${reservation.pax} pessoas na ${unit?.name || 'unidade'} (status: ${reservation.status})`;

        await supabase
          .from('whatsapp_chat_memories')
          .upsert({
            conversation_id: conversation.id,
            organization_id: orgId,
            contact_id: contactId,
            memory_type: 'fact',
            key: memoryKey,
            value: memoryValue,
            confidence: 1.0,
            source_message_id: null,
          }, {
            onConflict: 'conversation_id,key',
          });
      }

      // Create activity for the reservation
      const activityTitle = `Reserva ${reservation.confirmation_code} - ${unit?.name || ''}`;
      const activityDesc = `Data: ${reservation.reservation_date} às ${reservation.reservation_time}\nPessoas: ${reservation.pax}\nStatus: ${reservation.status}\nCódigo: ${reservation.confirmation_code}`;

      // Check if activity already exists
      const { data: existingActivity } = await supabase
        .from('activities')
        .select('id')
        .eq('contact_id', contactId)
        .like('title', `%${reservation.confirmation_code}%`)
        .limit(1);

      if (!existingActivity || existingActivity.length === 0) {
        await supabase.from('activities').insert({
          organization_id: orgId,
          contact_id: contactId,
          title: activityTitle,
          description: activityDesc,
          type: 'note',
          date: reservation.created_at || new Date().toISOString(),
          completed: reservation.status !== 'confirmed' && reservation.status !== 'pending',
        });
      }
    }

    return NextResponse.json({
      ok: true,
      synced: created + updated,
      created,
      updated,
      skipped,
      total_reservations: reservations.length,
    });
  } catch (err) {
    console.error('[reservation-sync] Error:', err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
