import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getInstance, getAIConfig, upsertAIConfig } from '@/lib/supabase/whatsapp';

type Params = { params: Promise<{ id: string }> };

/** Get AI config for a WhatsApp instance */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();

  const instance = await getInstance(queryClient, id);
  if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const config = await getAIConfig(queryClient, id);
  return NextResponse.json({ data: config });
}

/** Update AI config */
export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();

  // Skip role check when auth is bypassed
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (profile?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
  }

  const instance = await getInstance(queryClient, id);
  if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const body = await request.json().catch(() => ({}));

  const config = await upsertAIConfig(queryClient, id, instance.organization_id, body);
  return NextResponse.json({ data: config });
}
