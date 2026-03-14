import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getEvolutionCredentials } from '@/lib/evolution/helpers';
import * as evolution from '@/lib/evolution/client';

/**
 * One-time setup fix endpoint.
 * 1. Re-enables AI on all conversations for the org
 * 2. Reconfigures Evolution API webhook to point to the current APP_URL
 * 3. Updates the webhook_url in the database
 *
 * POST /api/whatsapp/setup-fix
 */
export async function POST() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
  }

  const organizationId = profile.organization_id;
  const results: Record<string, unknown> = {};

  // 1. Re-enable AI on all conversations
  const { data: conversations, error: convError } = await supabase
    .from('whatsapp_conversations')
    .update({
      ai_active: true,
      ai_pause_reason: null,
      ai_paused_at: null,
    })
    .eq('organization_id', organizationId)
    .eq('ai_active', false)
    .select('id, phone, contact_name');

  results.conversations_reactivated = conversations?.length ?? 0;
  results.conversations_reactivated_list = conversations?.map((c) => ({
    id: c.id,
    phone: c.phone,
    name: c.contact_name,
  }));

  if (convError) {
    results.conversations_error = convError.message;
  }

  // 2. Get all instances for this org
  const { data: instances } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('organization_id', organizationId);

  const appUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
  )?.replace(/\/+$/, '');

  results.app_url = appUrl;
  results.instances = [];

  if (instances && appUrl) {
    for (const inst of instances) {
      const instanceResult: Record<string, unknown> = {
        id: inst.id,
        name: inst.name,
        old_webhook_url: inst.webhook_url,
      };

      const newWebhookUrl = `${appUrl}/api/whatsapp/webhook/${inst.id}`;
      instanceResult.new_webhook_url = newWebhookUrl;

      try {
        const creds = await getEvolutionCredentials(supabase, {
          instance_token: inst.instance_token,
          evolution_instance_name: inst.evolution_instance_name,
          instance_id: inst.instance_id,
          organization_id: organizationId,
        });

        // Set webhook in Evolution API
        await evolution.setWebhook(creds, {
          enabled: true,
          url: newWebhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: [
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'CONNECTION_UPDATE',
            'QRCODE_UPDATED',
            'SEND_MESSAGE',
          ],
        });

        instanceResult.webhook_configured = true;

        // Also verify it was set
        const currentWebhook = await evolution.findWebhook(creds);
        instanceResult.webhook_verified = currentWebhook;

        // Update webhook_url in our database
        await supabase
          .from('whatsapp_instances')
          .update({ webhook_url: newWebhookUrl })
          .eq('id', inst.id);

        instanceResult.db_updated = true;
      } catch (err) {
        instanceResult.webhook_error = err instanceof Error ? err.message : String(err);
      }

      (results.instances as Record<string, unknown>[]).push(instanceResult);
    }
  }

  return NextResponse.json(results);
}
