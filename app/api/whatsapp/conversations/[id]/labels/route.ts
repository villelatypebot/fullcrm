import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getConversationLabels, assignLabel, removeLabel } from '@/lib/supabase/whatsappIntelligence';

type Params = { params: Promise<{ id: string }> };

// TEMPORARY: fallback org ID when auth is bypassed
const FALLBACK_ORG_ID = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';

/**
 * GET /api/whatsapp/conversations/[id]/labels - Get labels for a conversation
 * POST /api/whatsapp/conversations/[id]/labels - Assign a label
 * DELETE /api/whatsapp/conversations/[id]/labels - Remove a label
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();

  const labels = await getConversationLabels(queryClient, id);
  return NextResponse.json({ data: labels });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();
  let orgId: string;
  const userId = user?.id || '00000000-0000-0000-0000-000000000000';

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
  const { labelId } = body;

  if (!labelId) return NextResponse.json({ error: 'labelId is required' }, { status: 400 });

  const result = await assignLabel(queryClient, id, labelId, orgId, `user:${userId}`);
  return NextResponse.json({ data: result });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();

  const { searchParams } = new URL(request.url);
  const labelId = searchParams.get('labelId');

  if (!labelId) return NextResponse.json({ error: 'labelId is required' }, { status: 400 });

  await removeLabel(queryClient, id, labelId);
  return NextResponse.json({ ok: true });
}
