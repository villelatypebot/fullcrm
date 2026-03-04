import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getInstance, updateInstance, deleteInstance } from '@/lib/supabase/whatsapp';
import { getEvolutionCredentials, getEvolutionGlobalConfig } from '@/lib/evolution/helpers';
import * as evolution from '@/lib/evolution/client';

type Params = { params: Promise<{ id: string }> };

// TEMPORARY: helper to get supabase client (bypasses auth when no session)
async function getClient() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? supabase : createStaticAdminClient();
}

/** Get a WhatsApp instance details + live status from Evolution API */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const queryClient = await getClient();

  const instance = await getInstance(queryClient, id);
  if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Check live status from Evolution API
  let liveStatus: evolution.ConnectionState | null = null;
  try {
    const creds = await getEvolutionCredentials(queryClient, instance);
    liveStatus = await evolution.getConnectionState(creds);

    // Sync status if different
    const state = liveStatus?.instance?.state;
    const newStatus = state === 'open' ? 'connected' : 'disconnected';
    if (newStatus !== instance.status) {
      await updateInstance(queryClient, id, { status: newStatus });
      instance.status = newStatus as typeof instance.status;
    }
  } catch {
    // Evolution API may be unreachable; return stored status
  }

  return NextResponse.json({
    data: {
      ...instance,
      liveStatus: liveStatus ?? null,
    },
  });
}

/** Update instance (name, settings) */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const queryClient = await getClient();

  const body = await request.json().catch(() => ({}));
  const allowedFields = ['name', 'instance_id', 'instance_token', 'ai_enabled'];
  const updates: Record<string, unknown> = {};

  for (const key of allowedFields) {
    if (key in body) updates[key] = body[key];
  }

  const updated = await updateInstance(queryClient, id, updates);
  return NextResponse.json({ data: updated });
}

/** Delete instance */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const queryClient = await getClient();

  // Delete from Evolution API before removing from DB
  const instance = await getInstance(queryClient, id);
  if (instance) {
    try {
      const instanceName = instance.evolution_instance_name || instance.instance_id;
      const { baseUrl, globalApiKey } = await getEvolutionGlobalConfig(queryClient, instance.organization_id);
      await evolution.deleteEvolutionInstance(baseUrl, globalApiKey, instanceName);
    } catch {
      // Best effort — continue with DB deletion even if Evolution API call fails
    }
  }

  await deleteInstance(queryClient, id);
  return NextResponse.json({ ok: true });
}
