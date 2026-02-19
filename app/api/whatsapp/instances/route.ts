import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getInstances, createInstance } from '@/lib/supabase/whatsapp';
import * as zapi from '@/lib/zapi/client';

const CreateInstanceSchema = z.object({
  instanceId: z.string().min(1),
  instanceToken: z.string().min(1),
  clientToken: z.string().optional(),
  name: z.string().min(1).max(100),
});

/** List all WhatsApp instances */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  try {
    const instances = await getInstances(supabase, profile.organization_id);
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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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

  const body = await request.json().catch(() => null);
  const parsed = CreateInstanceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input', details: parsed.error.flatten() }, { status: 400 });
  }

  const { instanceId, instanceToken, clientToken, name } = parsed.data;

  // Verify Z-API credentials are valid
  const creds: zapi.ZApiCredentials = {
    instanceId,
    token: instanceToken,
    clientToken,
  };

  try {
    await zapi.getInstanceStatus(creds);
  } catch {
    return NextResponse.json(
      { error: 'Credenciais Z-API inválidas. Verifique o Instance ID e Token.' },
      { status: 400 },
    );
  }

  const instance = await createInstance(supabase, profile.organization_id, {
    instance_id: instanceId,
    instance_token: instanceToken,
    client_token: clientToken,
    name,
  });

  // Configure Z-API webhooks to point to our app
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (appUrl) {
    const baseWebhookUrl = `${appUrl}/api/whatsapp/webhook/${instance.id}`;
    try {
      await zapi.configureAllWebhooks(creds, baseWebhookUrl);
      console.log(`[whatsapp] Webhooks configured for instance ${instance.id}: ${baseWebhookUrl}`);
    } catch (webhookErr) {
      console.error('[whatsapp] Failed to configure webhooks:', webhookErr);
      // Don't fail the instance creation – user can retry via the configure-webhooks endpoint
    }
  } else {
    console.warn('[whatsapp] NEXT_PUBLIC_APP_URL not set – webhooks not configured. Set it in your environment variables.');
  }

  return NextResponse.json({ data: instance }, { status: 201 });
}
