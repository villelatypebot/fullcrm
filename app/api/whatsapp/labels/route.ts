import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getLabels, createLabel, ensureDefaultLabels } from '@/lib/supabase/whatsappIntelligence';

// TEMPORARY: fallback org ID when auth is bypassed
const FALLBACK_ORG_ID = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';

/**
 * GET /api/whatsapp/labels - List all labels for the organization
 * POST /api/whatsapp/labels - Create a new label
 */
export async function GET() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();
  let orgId: string;

  if (!user) {
    orgId = FALLBACK_ORG_ID;
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    orgId = profile.organization_id;
  }

  // Ensure default labels exist
  await ensureDefaultLabels(queryClient, orgId);

  const labels = await getLabels(queryClient, orgId);
  return NextResponse.json({ data: labels });
}

export async function POST(request: Request) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();
  let orgId: string;

  if (!user) {
    orgId = FALLBACK_ORG_ID;
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    orgId = profile.organization_id;
  }

  const body = await request.json();
  const { name, color, icon, description } = body;

  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const label = await createLabel(queryClient, {
    organization_id: orgId,
    name,
    color: color || '#6366f1',
    icon,
    description,
  });

  return NextResponse.json({ data: label });
}
