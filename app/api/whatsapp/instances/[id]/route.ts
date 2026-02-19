import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getInstance, updateInstance, deleteInstance } from '@/lib/supabase/whatsapp';
import * as zapi from '@/lib/zapi/client';

type Params = { params: Promise<{ id: string }> };

/** Get a WhatsApp instance details + live status from Z-API */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const instance = await getInstance(supabase, id);
  if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Check live status from Z-API
  let liveStatus: Awaited<ReturnType<typeof zapi.getInstanceStatus>> | null = null;
  try {
    liveStatus = await zapi.getInstanceStatus({
      instanceId: instance.instance_id,
      token: instance.instance_token,
      clientToken: instance.client_token ?? undefined,
    });

    // Sync status if different
    const newStatus = liveStatus.connected ? 'connected' : 'disconnected';
    if (newStatus !== instance.status) {
      await updateInstance(supabase, id, { status: newStatus });
      instance.status = newStatus as typeof instance.status;
    }
  } catch {
    // Z-API may be unreachable; return stored status
  }

  return NextResponse.json({
    data: {
      ...instance,
      liveStatus: liveStatus ?? null,
    },
  });
}

/** Update instance (name, credentials) */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const allowedFields = ['name', 'instance_id', 'instance_token', 'client_token', 'ai_enabled'];
  const updates: Record<string, unknown> = {};

  for (const key of allowedFields) {
    if (key in body) updates[key] = body[key];
  }

  const updated = await updateInstance(supabase, id, updates);
  return NextResponse.json({ data: updated });
}

/** Delete instance */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  // Disconnect from Z-API before deleting
  const instance = await getInstance(supabase, id);
  if (instance) {
    try {
      await zapi.disconnectInstance({
        instanceId: instance.instance_id,
        token: instance.instance_token,
        clientToken: instance.client_token ?? undefined,
      });
    } catch {
      // Best effort
    }
  }

  await deleteInstance(supabase, id);
  return NextResponse.json({ ok: true });
}
