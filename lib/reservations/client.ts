/**
 * Reservation System Client
 *
 * Connects to the FullHouse Reservations tables in the CRM Supabase.
 * Generates individual time slots from the range-based time_slots table.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  ReservationUnit,
  ReservationTimeSlot,
  Reservation,
  SlotAvailability,
  DayAvailability,
} from './types';

export class ReservationClient {
  private supabase: SupabaseClient;
  private organizationId: string;

  constructor(supabase: SupabaseClient, organizationId: string) {
    this.supabase = supabase;
    this.organizationId = organizationId;
  }

  /**
   * Get all active units (restaurants/locations).
   */
  async getUnits(): Promise<ReservationUnit[]> {
    // Reservation system is single-tenant — no organization_id filter needed
    const { data, error } = await this.supabase
      .from('units')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return data ?? [];
  }

  /**
   * Find a unit by partial name match (case-insensitive).
   * Returns the best match or null.
   */
  async findUnitByName(name: string): Promise<ReservationUnit | null> {
    const units = await this.getUnits();
    if (units.length === 0) return null;

    const normalized = name.toLowerCase().trim();

    // Exact slug match
    const slugMatch = units.find(u => u.slug === normalized);
    if (slugMatch) return slugMatch;

    // Partial name match (e.g. "boa vista" matches "Full House Boa Vista")
    const nameMatch = units.find(u => u.name.toLowerCase().includes(normalized));
    if (nameMatch) return nameMatch;

    // Slug partial match (e.g. "boa" matches "boa-vista")
    const slugPartial = units.find(u => u.slug.includes(normalized.replace(/\s+/g, '-')));
    if (slugPartial) return slugPartial;

    return null;
  }

  /**
   * Generate individual time slots from a range definition.
   * E.g. open_time=18:00, close_time=22:00, interval=30 → [18:00, 18:30, 19:00, ..., 21:30]
   */
  private generateSlotsFromRange(slot: ReservationTimeSlot): Array<{ time: string; maxPax: number }> {
    const results: Array<{ time: string; maxPax: number }> = [];

    const [openH, openM] = slot.open_time.split(':').map(Number);
    const [closeH, closeM] = slot.close_time.split(':').map(Number);
    const interval = slot.slot_interval_minutes || 30;

    let currentMinutes = openH * 60 + openM;
    const endMinutes = closeH * 60 + closeM;

    while (currentMinutes < endMinutes) {
      const h = Math.floor(currentMinutes / 60);
      const m = currentMinutes % 60;
      results.push({
        time: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        maxPax: slot.max_pax_per_slot,
      });
      currentMinutes += interval;
    }

    return results;
  }

  /**
   * Get availability for a specific unit and date.
   * Generates individual slots from the range-based time_slots table,
   * then subtracts existing reservations.
   */
  async getAvailability(unitId: string, date: string): Promise<DayAvailability> {
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();

    // Get time slot ranges for this day of the week (uses REAL column names)
    const { data: slotRanges, error: slotErr } = await this.supabase
      .from('time_slots')
      .select('*')
      .eq('unit_id', unitId)
      .eq('day_of_week', dayOfWeek)
      .eq('is_active', true)
      .order('open_time');

    if (slotErr) throw slotErr;

    // Get existing reservations for this date
    const { data: reservations } = await this.supabase
      .from('reservations')
      .select('reservation_time, pax, status')
      .eq('unit_id', unitId)
      .eq('reservation_date', date)
      .in('status', ['pending', 'confirmed', 'seated']);

    // Get unit info
    const { data: unit } = await this.supabase
      .from('units')
      .select('name')
      .eq('id', unitId)
      .single();

    // Check for date blocks
    const { data: dateBlocks } = await this.supabase
      .from('date_blocks')
      .select('id')
      .eq('unit_id', unitId)
      .eq('blocked_date', date)
      .limit(1);

    if (dateBlocks && dateBlocks.length > 0) {
      return {
        date,
        unitName: unit?.name || '',
        slots: [],
        totalAvailable: 0,
      };
    }

    // Generate individual time slots from each range
    const allGeneratedSlots: Array<{ time: string; maxPax: number }> = [];
    for (const range of (slotRanges ?? []) as ReservationTimeSlot[]) {
      allGeneratedSlots.push(...this.generateSlotsFromRange(range));
    }

    // Calculate availability per generated slot
    const slotAvailability: SlotAvailability[] = allGeneratedSlots.map((slot) => {
      // Match reservations by time (handle both HH:MM and HH:MM:SS formats)
      const reservedPax = (reservations ?? [])
        .filter((r) => {
          const rTime = r.reservation_time?.substring(0, 5);
          return rTime === slot.time;
        })
        .reduce((sum: number, r) => sum + (r.pax || 0), 0);

      return {
        time: slot.time,
        maxPax: slot.maxPax,
        reservedPax,
        availablePax: Math.max(0, slot.maxPax - reservedPax),
      };
    });

    return {
      date,
      unitName: unit?.name || '',
      slots: slotAvailability,
      totalAvailable: slotAvailability.reduce((sum, s) => sum + s.availablePax, 0),
    };
  }

  /**
   * Create a reservation.
   */
  async createReservation(params: {
    unitId: string;
    date: string;
    time: string;
    pax: number;
    name: string;
    phone: string;
    email?: string;
    environmentId?: string;
  }): Promise<Reservation> {
    // Upsert customer
    const { data: customer, error: custErr } = await this.supabase
      .from('customers')
      .upsert(
        { name: params.name, phone: params.phone, email: params.email || null },
        { onConflict: 'phone' },
      )
      .select('id')
      .single();

    if (custErr || !customer) throw new Error('Failed to create/find customer');

    // Create reservation
    const { data, error } = await this.supabase
      .from('reservations')
      .insert({
        unit_id: params.unitId,
        environment_id: params.environmentId || null,
        customer_id: customer.id,
        reservation_date: params.date,
        reservation_time: params.time,
        pax: params.pax,
        status: 'confirmed',
        source: 'whatsapp_ai',
      })
      .select('*')
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Look up a reservation by confirmation code.
   */
  async getByCode(code: string): Promise<Reservation | null> {
    const { data } = await this.supabase
      .from('reservations')
      .select('*, customers(*), units(name, slug)')
      .eq('confirmation_code', code.toUpperCase())
      .single();

    return data ?? null;
  }

  /**
   * Look up reservations by customer phone number.
   * Returns upcoming reservations (today and future) sorted by date.
   */
  async getReservationsByPhone(phone: string): Promise<Reservation[]> {
    // Normalize phone: keep only digits, try with and without country code
    const digits = phone.replace(/\D/g, '');
    const phoneVariants = [digits];
    if (digits.startsWith('55') && digits.length >= 12) {
      phoneVariants.push(digits.substring(2)); // without country code
    } else if (digits.length <= 11) {
      phoneVariants.push('55' + digits); // with country code
    }

    // Find customer by phone
    const { data: customers } = await this.supabase
      .from('customers')
      .select('id')
      .or(phoneVariants.map(p => `phone.like.%${p.slice(-8)}%`).join(','));

    if (!customers || customers.length === 0) return [];

    const customerIds = customers.map(c => c.id);
    const today = new Date().toISOString().split('T')[0];

    // Get future reservations
    const { data: reservations, error } = await this.supabase
      .from('reservations')
      .select('*, customers(name, phone), units(name, slug)')
      .in('customer_id', customerIds)
      .gte('reservation_date', today)
      .in('status', ['pending', 'confirmed', 'seated'])
      .order('reservation_date', { ascending: true })
      .order('reservation_time', { ascending: true })
      .limit(5);

    if (error) throw error;
    return reservations ?? [];
  }

  /**
   * Get reservations for a specific date and unit.
   */
  async getReservationsForDate(unitId: string, date: string): Promise<Reservation[]> {
    const { data, error } = await this.supabase
      .from('reservations')
      .select('*, customers(name, phone)')
      .eq('unit_id', unitId)
      .eq('reservation_date', date)
      .in('status', ['pending', 'confirmed', 'seated'])
      .order('reservation_time');

    if (error) throw error;
    return data ?? [];
  }

  /**
   * Build a human-readable availability summary for AI context.
   */
  async buildAvailabilitySummary(unitId?: string): Promise<string> {
    const units = unitId
      ? [{ id: unitId, name: '', slug: '', is_active: true } as ReservationUnit]
      : await this.getUnits();

    if (units.length === 0) return 'Nenhuma unidade de reserva configurada.';

    const today = new Date();
    const lines: string[] = ['=== DISPONIBILIDADE DE RESERVAS ==='];

    for (const unit of units) {
      // Check today and next 2 days
      for (let offset = 0; offset < 3; offset++) {
        const date = new Date(today);
        date.setDate(date.getDate() + offset);
        const dateStr = date.toISOString().split('T')[0];
        const dayLabel = offset === 0 ? 'Hoje' : offset === 1 ? 'Amanhã' : date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' });

        try {
          const availability = await this.getAvailability(unit.id, dateStr);
          if (availability.slots.length === 0) {
            lines.push(`${availability.unitName || unit.name} - ${dayLabel}: SEM HORÁRIOS DISPONÍVEIS`);
            continue;
          }

          const availableSlots = availability.slots.filter(s => s.availablePax > 0);
          if (availableSlots.length === 0) {
            lines.push(`${availability.unitName || unit.name} - ${dayLabel}: LOTADO`);
          } else {
            const slotsText = availableSlots
              .map(s => `${s.time} (${s.availablePax} vagas)`)
              .join(', ');
            lines.push(`${availability.unitName || unit.name} - ${dayLabel}: ${slotsText}`);
          }
        } catch {
          // Skip unit on error
        }
      }
    }

    lines.push('');
    lines.push('Link para reserva online: https://fullhouseagendamento.vercel.app');

    return lines.join('\n');
  }
}

/**
 * Create a ReservationClient using the reservation system's Supabase credentials.
 * Reads reservation_supabase_url and reservation_supabase_key from organization_settings.
 */
export async function createReservationClient(
  crmSupabase: SupabaseClient,
  organizationId: string,
): Promise<ReservationClient | null> {
  // Get reservation Supabase credentials from CRM settings
  const { data: settings } = await crmSupabase
    .from('organization_settings')
    .select('reservation_supabase_url, reservation_supabase_key')
    .eq('organization_id', organizationId)
    .single();

  if (!settings?.reservation_supabase_url || !settings?.reservation_supabase_key) {
    console.warn('[reservation-client] No reservation Supabase credentials configured');
    return null;
  }

  // Create a separate Supabase client for the reservation system
  const reservationSupabase = createClient(
    settings.reservation_supabase_url,
    settings.reservation_supabase_key,
  );

  return new ReservationClient(reservationSupabase, organizationId);
}
