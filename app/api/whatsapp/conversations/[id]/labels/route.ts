import { NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';
import { getConversationLabels, assignLabel, removeLabel } from '@/lib/supabase/whatsappIntelligence';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/whatsapp/conversations/[id]/labels - Get labels for a conversation
 * POST /api/whatsapp/conversations/[id]/labels - Assign a label
 * DELETE /api/whatsapp/conversations/[id]/labels - Remove a label
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const labels = await getConversationLabels(supabase, id);
  return NextResponse.json({ data: labels });
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
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
  const { labelId } = body;

  if (!labelId) return NextResponse.json({ error: 'labelId is required' }, { status: 400 });

  const result = await assignLabel(supabase, id, labelId, profile.organization_id, `user:${user.id}`);
  return NextResponse.json({ data: result });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const labelId = searchParams.get('labelId');

  if (!labelId) return NextResponse.json({ error: 'labelId is required' }, { status: 400 });

  await removeLabel(supabase, id, labelId);
  return NextResponse.json({ ok: true });
}
