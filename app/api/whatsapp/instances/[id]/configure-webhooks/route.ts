import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as zapi from '@/lib/zapi/client';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/whatsapp/instances/[id]/configure-webhooks
 *
 * Manually (re-)configure Z-API webhooks for an instance.
 * Useful when NEXT_PUBLIC_APP_URL was missing at creation time
 * or when the deployment URL changed.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
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

  // Get the instance
  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .single();

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }

  const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);
  if (!rawAppUrl) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_APP_URL não configurada. Adicione nas variáveis de ambiente do Vercel.' },
      { status: 500 },
    );
  }

  // Strip trailing slash to prevent double-slash in webhook URL
  const appUrl = rawAppUrl.replace(/\/+$/, '');

  const creds: zapi.ZApiCredentials = {
    instanceId: instance.instance_id,
    token: instance.instance_token,
    clientToken: instance.client_token ?? undefined,
  };

  const baseWebhookUrl = `${appUrl}/api/whatsapp/webhook/${instance.id}`;

  try {
    await zapi.configureAllWebhooks(creds, baseWebhookUrl);
    return NextResponse.json({
      ok: true,
      webhookUrl: baseWebhookUrl,
      message: 'Webhooks configurados com sucesso!',
    });
  } catch (err) {
    console.error('[configure-webhooks] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Falha ao configurar webhooks' },
      { status: 500 },
    );
  }
}
