import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getInstances } from '@/lib/supabase/whatsapp';
import { getEvolutionGlobalConfig, generateInstanceName } from '@/lib/evolution/helpers';
import * as evolution from '@/lib/evolution/client';

// TEMPORARY: fallback org ID when auth is bypassed
const FALLBACK_ORG_ID = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';

const CreateInstanceSchema = z.object({
  name: z.string().min(1).max(100),
});

/** List all WhatsApp instances */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // TEMPORARY: bypass auth
  let orgId: string;
  if (!user) {
    orgId = FALLBACK_ORG_ID;
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    orgId = profile.organization_id;
  }

  const queryClient = user ? supabase : createStaticAdminClient();

  try {
    const instances = await getInstances(queryClient, orgId);
    return NextResponse.json({ data: instances });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    const isTableMissing = msg.includes('whatsapp_instances') || msg.includes('relation') || msg.includes('42P01');
    if (isTableMissing) {
      return NextResponse.json(
        { error: 'Tabelas do WhatsApp não encontradas. Execute a migration no Supabase.' },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** Create a new WhatsApp instance */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  // TEMPORARY: bypass auth
  let orgId: string;
  if (!user) {
    orgId = FALLBACK_ORG_ID;
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    if (profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }
    orgId = profile.organization_id;
  }

  const queryClient = user ? supabase : createStaticAdminClient();

  const body = await request.json().catch(() => null);
  const parsed = CreateInstanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  const { name } = parsed.data;

  // Get Evolution API global config (URL + global API key)
  let baseUrl: string;
  let globalApiKey: string;
  try {
    ({ baseUrl, globalApiKey } = await getEvolutionGlobalConfig(queryClient, orgId));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Evolution API não configurada.' },
      { status: 400 },
    );
  }

  // Generate a unique instance name for Evolution API
  const instanceName = generateInstanceName(orgId, name);

  // Insert DB record first with placeholder values
  const { data: dbInstance, error: dbError } = await queryClient
    .from('whatsapp_instances')
    .insert({
      organization_id: orgId,
      name,
      instance_id: instanceName,
      instance_token: 'pending',
      evolution_instance_name: instanceName,
      status: 'disconnected',
    })
    .select()
    .single();

  if (dbError || !dbInstance) {
    return NextResponse.json(
      { error: dbError?.message || 'Falha ao criar registro no banco de dados.' },
      { status: 500 },
    );
  }

  // Build webhook URL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  const webhookUrl = appUrl ? `${appUrl.replace(/\/+$/, '')}/api/whatsapp/webhook/${dbInstance.id}` : undefined;

  // Create instance on Evolution API
  let evoResult: evolution.CreateInstanceResponse;
  try {
    evoResult = await evolution.createInstance(baseUrl, globalApiKey, {
      instanceName,
      integration: 'WHATSAPP-BAILEYS',
      qrcode: false,
      rejectCall: true,
      msgCall: 'Não posso atender ligações no momento. Por favor, envie uma mensagem.',
      groupsIgnore: true,
      alwaysOnline: true,
      readMessages: true,
      readStatus: true,
      syncFullHistory: true,
      ...(webhookUrl ? {
        webhook: {
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: true,
          events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED', 'SEND_MESSAGE'],
        },
      } : {}),
    });
  } catch (err) {
    // Evolution API creation failed — clean up the DB record
    console.error('[whatsapp] Failed to create Evolution API instance:', err);
    await queryClient.from('whatsapp_instances').delete().eq('id', dbInstance.id);
    return NextResponse.json(
      { error: 'Falha ao criar instância na Evolution API.' },
      { status: 502 },
    );
  }

  // Update DB record with real credentials from Evolution API
  const { data: updatedInstance } = await queryClient
    .from('whatsapp_instances')
    .update({
      instance_id: evoResult.instance.instanceId,
      instance_token: evoResult.hash.apikey,
      webhook_url: webhookUrl,
      updated_at: new Date().toISOString(),
    })
    .eq('id', dbInstance.id)
    .select()
    .single();

  // Configure WebSocket for real-time events
  const instanceCreds: evolution.EvolutionCredentials = {
    baseUrl,
    apiKey: evoResult.hash.apikey,
    instanceName,
  };

  await evolution.setWebSocket(instanceCreds, {
    enabled: true,
    events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED', 'SEND_MESSAGE'],
  }).catch(err => console.error('[whatsapp] Failed to configure WebSocket:', err));

  if (!webhookUrl) {
    console.warn('[whatsapp] NEXT_PUBLIC_APP_URL not set – webhooks not configured. Set it in your environment variables.');
  }

  return NextResponse.json({ data: updatedInstance ?? dbInstance }, { status: 201 });
}
