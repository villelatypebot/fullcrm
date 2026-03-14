import { NextResponse } from 'next/server';
import { authPublicApi } from '@/lib/public-api/auth';
import { createReservationClient } from '@/lib/reservations/client';
import { createStaticAdminClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * GET /api/public/v1/reservations?date=YYYY-MM-DD
 *
 * Get reservations and availability for a date.
 * If no date is provided, returns availability for the next 7 days.
 */
export async function GET(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date');

  const supabase = createStaticAdminClient();
  const client = await createReservationClient(supabase, auth.organizationId);

  if (!client) {
    return NextResponse.json({ error: 'Reservation system not configured' }, { status: 404 });
  }

  try {
    const units = await client.getUnits();
    if (units.length === 0) {
      return NextResponse.json({ data: { units: [], availability: [] } });
    }

    if (date) {
      const availability = await client.getAvailability(units[0].id, date);
      return NextResponse.json({ data: { availability } });
    }

    // Return next 7 days availability
    const today = new Date();
    const allAvailability: Awaited<ReturnType<typeof client.getAvailability>>[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      const avail = await client.getAvailability(units[0].id, dateStr);
      allAvailability.push(avail);
    }

    return NextResponse.json({ data: { units, availability: allAvailability } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error fetching reservations' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/public/v1/reservations
 *
 * Create a reservation.
 *
 * Body: { name, phone, date, time, pax, email? }
 */
export async function POST(request: Request) {
  const auth = await authPublicApi(request);
  if (!auth.ok) {
    return NextResponse.json(auth.body, { status: auth.status });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { name, phone, date, time, pax, email } = body;
  if (!name || !phone || !date || !time || !pax) {
    return NextResponse.json(
      { error: 'Missing required fields: name, phone, date, time, pax' },
      { status: 400 },
    );
  }

  const supabase = createStaticAdminClient();
  const client = await createReservationClient(supabase, auth.organizationId);

  if (!client) {
    return NextResponse.json({ error: 'Reservation system not configured' }, { status: 404 });
  }

  try {
    const units = await client.getUnits();
    if (units.length === 0) {
      return NextResponse.json({ error: 'No units available' }, { status: 404 });
    }

    const reservation = await client.createReservation({
      unitId: units[0].id,
      date,
      time,
      pax: Number(pax),
      name,
      phone,
      email,
    });

    return NextResponse.json({ data: reservation }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Error creating reservation' },
      { status: 500 },
    );
  }
}
