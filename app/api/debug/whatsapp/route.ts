import { NextResponse } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';

const ORG_ID = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';

/**
 * GET /api/debug/whatsapp
 *
 * Diagnostic endpoint: shows DB state + Evolution API state.
 * REMOVE after debugging.
 */
export async function GET() {
  const admin = createStaticAdminClient();
  const results: Record<string, unknown> = {};

  // 1. Check if whatsapp_instances table exists and has data
  try {
    const { data: instances, error } = await admin
      .from('whatsapp_instances')
      .select('*')
      .eq('organization_id', ORG_ID);

    if (error) {
      results.db_instances = { error: error.message, code: error.code, hint: error.hint };
    } else {
      results.db_instances = instances;
      results.db_instances_count = instances?.length ?? 0;
    }
  } catch (err) {
    results.db_instances = { error: String(err) };
  }

  // 2. Check organization_settings for Evolution API config
  try {
    const { data: settings, error } = await admin
      .from('organization_settings')
      .select('evolution_api_url, evolution_api_key')
      .eq('organization_id', ORG_ID)
      .maybeSingle();

    if (error) {
      results.org_settings = { error: error.message };
    } else {
      results.org_settings = {
        evolution_api_url: settings?.evolution_api_url || '(not set)',
        has_api_key: Boolean(settings?.evolution_api_key),
      };

      // 3. If Evolution API is configured, list instances from the API
      if (settings?.evolution_api_url && settings?.evolution_api_key) {
        try {
          const url = `${settings.evolution_api_url.replace(/\/+$/, '')}/instance/fetchInstances`;
          const resp = await fetch(url, {
            method: 'GET',
            headers: { apikey: settings.evolution_api_key },
          });
          const evoData = await resp.json();
          results.evolution_api_instances = evoData;
          results.evolution_api_instances_count = Array.isArray(evoData) ? evoData.length : 'not array';
        } catch (err) {
          results.evolution_api_instances = { error: String(err) };
        }
      }
    }
  } catch (err) {
    results.org_settings = { error: String(err) };
  }

  // 4. Check whatsapp_conversations count
  try {
    const { count, error } = await admin
      .from('whatsapp_conversations')
      .select('*', { count: 'exact', head: true })
      .eq('organization_id', ORG_ID);

    results.conversations_count = error ? { error: error.message } : count;
  } catch (err) {
    results.conversations_count = { error: String(err) };
  }

  // 5. Check if migration columns exist
  try {
    const { data, error } = await admin
      .from('whatsapp_instances')
      .select('id, evolution_instance_name')
      .limit(1);

    results.migration_check = error
      ? { error: error.message, hint: 'evolution_instance_name column may not exist - run migration' }
      : { ok: true, sample: data };
  } catch (err) {
    results.migration_check = { error: String(err) };
  }

  // 6. Environment
  results.env = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || '(not set)',
    VERCEL_URL: process.env.VERCEL_URL || '(not set)',
    has_service_role_key: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY),
  };

  return NextResponse.json(results, { status: 200 });
}
