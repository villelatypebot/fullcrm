import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getLabels, createLabel, ensureDefaultLabels } from '@/lib/supabase/whatsappIntelligence';

/**
 * GET /api/whatsapp/labels - List all labels for the organization
 * POST /api/whatsapp/labels - Create a new label
 */
export async function GET() {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  // Ensure default labels exist
  await ensureDefaultLabels(supabase, profile.organization_id);

  const labels = await getLabels(supabase, profile.organization_id);
  return NextResponse.json({ data: labels });
}

export async function POST(request: Request) {
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  const body = await request.json();
  const { name, color, icon, description } = body;

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const label = await createLabel(supabase, {
    organization_id: profile.organization_id,
    name,
    color: color || '#6366f1',
    icon,
    description,
  });

  return NextResponse.json({ data: label });
}
