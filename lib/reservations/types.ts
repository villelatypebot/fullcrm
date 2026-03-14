/**
 * Types for the FullHouse Reservation system integration.
 * The reservation system is a separate Supabase project.
 */

export interface ReservationUnit {
  id: string;
  name: string;
  slug: string;
  address?: string;
  phone?: string;
  max_pax_per_slot?: number;
  is_active: boolean;
}

export interface ReservationTimeSlot {
  id: string;
  unit_id: string;
  day_of_week: number; // 0=Sun, 1=Mon, ...
  start_time: string; // HH:MM
  end_time: string;   // HH:MM
  max_pax: number;
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
  units?: ReservationUnit;
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
