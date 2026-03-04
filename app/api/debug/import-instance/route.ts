import { NextResponse } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';

const ORG_ID = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';

/**
 * POST /api/debug/import-instance
 *
 * Imports an existing Evolution API instance into the CRM database.
 * This bridges the gap when an instance was created directly in
 * Evolution API (not through the CRM).
 *
 * REMOVE after import is done.
 */
export async function POST() {
  const admin = createStaticAdminClient();

  // 1. Get Evolution API config
  const { data: settings, error: settingsErr } = await admin
    .from('organization_settings')
    .select('evolution_api_url, evolution_api_key')
    .eq('organization_id', ORG_ID)
    .single();

  if (settingsErr || !settings?.evolution_api_url || !settings?.evolution_api_key) {
    return NextResponse.json({ error: 'Evolution API not configured' }, { status: 400 });
  }

  // 2. Fetch instances from Evolution API
  const evoUrl = `${settings.evolution_api_url.replace(/\/+$/, '')}/instance/fetchInstances`;
  const evoResp = await fetch(evoUrl, {
    headers: { apikey: settings.evolution_api_key },
  });

  if (!evoResp.ok) {
    return NextResponse.json({ error: `Evolution API error: ${evoResp.status}` }, { status: 502 });
  }

  const evoInstances = await evoResp.json();

  if (!Array.isArray(evoInstances) || evoInstances.length === 0) {
    return NextResponse.json({ error: 'No instances found in Evolution API' }, { status: 404 });
  }

  const imported: unknown[] = [];
  const errors: unknown[] = [];

  for (const evo of evoInstances) {
    const instanceName = evo.name || evo.id;
    const instanceId = evo.id;
    const token = evo.token || settings.evolution_api_key;
    const status = evo.connectionStatus === 'open' ? 'connected' : 'disconnected';
    const phone = evo.ownerJid?.replace('@s.whatsapp.net', '') || evo.number || '';

    // Check if already imported
    const { data: existing } = await admin
      .from('whatsapp_instances')
      .select('id')
      .eq('instance_id', instanceId)
      .maybeSingle();

    if (existing) {
      imported.push({ name: instanceName, status: 'already_exists', db_id: existing.id });
      continue;
    }

    // Also check by evolution_instance_name
    const { data: existingByName } = await admin
      .from('whatsapp_instances')
      .select('id')
      .eq('evolution_instance_name', instanceName)
      .maybeSingle();

    if (existingByName) {
      imported.push({ name: instanceName, status: 'already_exists_by_name', db_id: existingByName.id });
      continue;
    }

    // Build webhook URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null);

    // Insert into DB
    const { data: dbInstance, error: insertErr } = await admin
      .from('whatsapp_instances')
      .insert({
        organization_id: ORG_ID,
        name: instanceName,
        instance_id: instanceId,
        instance_token: token,
        evolution_instance_name: instanceName,
        status,
        phone,
        webhook_url: appUrl ? `${appUrl.replace(/\/+$/, '')}/api/whatsapp/webhook/PENDING` : null,
      })
      .select()
      .single();

    if (insertErr) {
      errors.push({ name: instanceName, error: insertErr.message });
      continue;
    }

    // Update webhook URL with the actual DB ID
    if (appUrl && dbInstance) {
      const webhookUrl = `${appUrl.replace(/\/+$/, '')}/api/whatsapp/webhook/${dbInstance.id}`;
      await admin
        .from('whatsapp_instances')
        .update({ webhook_url: webhookUrl })
        .eq('id', dbInstance.id);

      // Configure webhook on Evolution API
      try {
        const webhookSetUrl = `${settings.evolution_api_url.replace(/\/+$/, '')}/webhook/set/${instanceName}`;
        await fetch(webhookSetUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: token,
          },
          body: JSON.stringify({
            enabled: true,
            url: webhookUrl,
            webhookByEvents: false,
            webhookBase64: true,
            events: ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'CONNECTION_UPDATE', 'QRCODE_UPDATED', 'SEND_MESSAGE'],
          }),
        });
      } catch {
        // Best effort
      }
    }

    imported.push({
      name: instanceName,
      status: 'imported',
      db_id: dbInstance?.id,
      phone,
      connectionStatus: evo.connectionStatus,
      messages: evo._count?.Message,
      contacts: evo._count?.Contact,
      chats: evo._count?.Chat,
    });
  }

  return NextResponse.json({
    ok: true,
    imported,
    errors,
    message: `${imported.length} instance(s) processed. Refresh the WhatsApp page to see them.`,
  });
}
