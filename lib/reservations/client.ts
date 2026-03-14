/**
 * Reservation System Client
 *
 * Connects directly to the FullHouse Reservations Supabase project
 * using the service_role key for full access.
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

  constructor(supabaseUrl: string, serviceRoleKey: string) {
    this.supabase = createClient(supabaseUrl, serviceRoleKey);
  }

  /**
   * Get all active units (restaurants/locations).
   */
  async getUnits(): Promise<ReservationUnit[]> {
    const { data, error } = await this.supabase
      .from('units')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) throw error;
    return data ?? [];
  }

  /**
   * Get availability for a specific unit and date.
   * Calculates available spots per time slot.
   */
  async getAvailability(unitId: string, date: string): Promise<DayAvailability> {
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();

    // Get time slots for this day of the week
    const { data: slots } = await this.supabase
      .from('time_slots')
      .select('*')
      .eq('unit_id', unitId)
      .eq('day_of_week', dayOfWeek)
      .eq('is_active', true)
      .order('start_time');

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

    // Calculate availability per slot
    const slotAvailability: SlotAvailability[] = (slots ?? []).map((slot: ReservationTimeSlot) => {
      const reservedPax = (reservations ?? [])
        .filter((r) => r.reservation_time === slot.start_time)
        .reduce((sum: number, r) => sum + (r.pax || 0), 0);

      return {
        time: slot.start_time,
        maxPax: slot.max_pax,
        reservedPax,
        availablePax: Math.max(0, slot.max_pax - reservedPax),
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
 * Create a ReservationClient from organization settings.
 */
export async function createReservationClient(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<ReservationClient | null> {
  const { data: settings } = await supabase
    .from('organization_settings')
    .select('reservation_supabase_url, reservation_supabase_key')
    .eq('organization_id', organizationId)
    .single();

  if (!settings?.reservation_supabase_url || !settings?.reservation_supabase_key) {
    return null;
  }

  return new ReservationClient(settings.reservation_supabase_url, settings.reservation_supabase_key);
}
