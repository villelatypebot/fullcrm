/**
 * Types for the FullHouse Reservation system integration.
 * Matches the ACTUAL database schema in the CRM Supabase.
 */

export interface ReservationUnit {
  id: string;
  name: string;
  slug: string;
  address?: string;
  phone?: string;
  max_pax_per_slot?: number;
  is_active: boolean;
  organization_id?: string;
}

/**
 * DB schema: time_slots stores a range (open_time → close_time)
 * with intervals, NOT individual slot rows.
 */
export interface ReservationTimeSlot {
  id: string;
  unit_id: string;
  day_of_week: number; // 0=Sun, 1=Mon, ...
  open_time: string;   // HH:MM:SS (e.g. "18:00:00")
  close_time: string;  // HH:MM:SS (e.g. "22:00:00")
  slot_interval_minutes: number; // e.g. 30
  max_pax_per_slot: number;      // e.g. 60
  is_active: boolean;
}

export interface ReservationCustomer {
  id: string;
  name: string;
  email?: string;
  phone: string;
}

export interface Reservation {
  id: string;
  unit_id: string;
  environment_id?: string;
  customer_id: string;
  reservation_date: string; // YYYY-MM-DD
  reservation_time: string; // HH:MM
  pax: number;
  status: 'pending' | 'confirmed' | 'seated' | 'no_show' | 'cancelled';
  confirmation_code: string;
  source?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
  // Joined
  customers?: ReservationCustomer;
  units?: Pick<ReservationUnit, 'name' | 'slug'>;
}

export interface SlotAvailability {
  time: string;
  maxPax: number;
  reservedPax: number;
  availablePax: number;
}

export interface DayAvailability {
  date: string;
  unitName: string;
  slots: SlotAvailability[];
  totalAvailable: number;
}
