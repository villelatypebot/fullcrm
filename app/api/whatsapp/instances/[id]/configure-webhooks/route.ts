import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getEvolutionCredentials } from '@/lib/evolution/helpers';
import * as evolution from '@/lib/evolution/client';

type Params = { params: Promise<{ id: string }> };

// TEMPORARY: fallback org ID when auth is bypassed
const FALLBACK_ORG_ID = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';

/**
 * POST /api/whatsapp/instances/[id]/configure-webhooks
 *
 * Manually (re-)configure Evolution API webhooks for an instance.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
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
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    orgId = profile.organization_id;
  }

  // Get the instance
  const { data: instance } = await queryClient
    .from('whatsapp_instances')
    .select('*')
    .eq('id', id)
    .eq('organization_id', orgId)
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

  const appUrl = rawAppUrl.replace(/\/+$/, '');
  const creds = await getEvolutionCredentials(queryClient, instance);
  const baseWebhookUrl = `${appUrl}/api/whatsapp/webhook/${instance.id}`;

  try {
    await evolution.setWebhook(creds, {
      enabled: true,
      url: baseWebhookUrl,
      webhookByEvents: false,
      webhookBase64: true,
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED', 'SEND_MESSAGE'],
    });

    await evolution.setWebSocket(creds, {
      enabled: true,
      events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED', 'SEND_MESSAGE'],
    }).catch(err => console.error('[configure-webhooks] WebSocket config failed:', err));

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
