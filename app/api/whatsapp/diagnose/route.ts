import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { getAIConfig } from '@/lib/supabase/whatsapp';

/**
 * Diagnostic endpoint - tests the full AI pipeline step by step.
 * GET /api/whatsapp/diagnose
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) return NextResponse.json({ error: 'No org' }, { status: 404 });

  const adminSupabase = createStaticAdminClient();
  const orgId = profile.organization_id;
  const results: Record<string, unknown> = {};

  // Step 1: Check instance
  const { data: instances } = await adminSupabase
    .from('whatsapp_instances')
    .select('*')
    .eq('organization_id', orgId);

  const instance = instances?.[0];
  results.step1_instance = instance ? {
    id: instance.id,
    status: instance.status,
    ai_enabled: instance.ai_enabled,
    webhook_url: instance.webhook_url,
  } : 'NOT FOUND';

  if (!instance) return NextResponse.json(results);

  // Step 2: Check AI config
  const config = await getAIConfig(adminSupabase, instance.id);
  results.step2_ai_config = config ? {
    agent_name: config.agent_name,
    agent_tone: config.agent_tone,
    has_prompt: !!config.system_prompt,
    prompt_length: config.system_prompt?.length,
    memory_enabled: config.memory_enabled,
    follow_up_enabled: config.follow_up_enabled,
    lead_scoring_enabled: config.lead_scoring_enabled,
  } : 'NOT FOUND - THIS IS THE PROBLEM';

  // Step 3: Check organization_settings for API key
  const { data: orgSettings, error: orgError } = await adminSupabase
    .from('organization_settings')
    .select('ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
    .eq('organization_id', orgId)
    .single();

  const provider = orgSettings?.ai_provider ?? 'openai';
  let apiKey: string | undefined;
  if (provider === 'google') apiKey = orgSettings?.ai_google_key;
  else if (provider === 'openai') apiKey = orgSettings?.ai_openai_key;
  else if (provider === 'anthropic') apiKey = orgSettings?.ai_anthropic_key;

  results.step3_api_key = {
    provider: orgSettings?.ai_provider,
    model: orgSettings?.ai_model,
    has_key: !!apiKey,
    key_prefix: apiKey ? apiKey.substring(0, 10) + '...' : 'MISSING - THIS IS THE PROBLEM',
    org_error: orgError?.message,
  };

  // Step 4: Check Lucas's conversation specifically
  const { data: lucasConvo } = await adminSupabase
    .from('whatsapp_conversations')
    .select('*')
    .eq('organization_id', orgId)
    .like('phone', '%5521996056963%')
    .maybeSingle();

  results.step4_lucas_conversation = lucasConvo ? {
    id: lucasConvo.id,
    phone: lucasConvo.phone,
    ai_active: lucasConvo.ai_active,
    ai_pause_reason: lucasConvo.ai_pause_reason,
    status: lucasConvo.status,
    instance_id: lucasConvo.instance_id,
    instance_matches: lucasConvo.instance_id === instance.id,
  } : 'NOT FOUND';

  // Step 5: Check ALL conversations ai_active status
  const { data: allConvos } = await adminSupabase
    .from('whatsapp_conversations')
    .select('id, phone, contact_name, ai_active, ai_pause_reason, instance_id')
    .eq('organization_id', orgId)
    .order('last_message_at', { ascending: false })
    .limit(20);

  results.step5_all_conversations = (allConvos || []).map(c => ({
    phone: c.phone,
    name: c.contact_name,
    ai_active: c.ai_active,
    pause_reason: c.ai_pause_reason,
    instance_id: c.instance_id,
    instance_matches: c.instance_id === instance.id,
  }));

  // Step 6: Check recent AI logs
  const { data: aiLogs } = await adminSupabase
    .from('whatsapp_ai_logs')
    .select('*')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(10);

  results.step6_ai_logs = (aiLogs || []).map(l => ({
    action: l.action,
    details: l.details,
    created_at: l.created_at,
    conversation_id: l.conversation_id,
  }));

  // Step 7: Test OpenAI API key with a simple call
  if (apiKey && provider === 'openai') {
    try {
      const { generateText } = await import('ai');
      const { createOpenAI } = await import('@ai-sdk/openai');
      const openai = createOpenAI({ apiKey });
      const model = orgSettings?.ai_model ?? 'gpt-4.1';
      const testResult = await generateText({
        model: openai(model),
        messages: [{ role: 'user', content: 'Responda apenas "OK" para confirmar que funciona.' }],
        maxOutputTokens: 10,
      });
      results.step7_openai_test = {
        success: true,
        response: testResult.text,
        model_used: model,
      };
    } catch (err) {
      results.step7_openai_test = {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  } else {
    results.step7_openai_test = { skipped: true, reason: `No key for provider: ${provider}` };
  }

  // Step 8: Check Evolution API connection
  if (instance) {
    try {
      const { getEvolutionCredentials } = await import('@/lib/evolution/helpers');
      const creds = await getEvolutionCredentials(adminSupabase, {
        instance_token: instance.instance_token,
        evolution_instance_name: instance.evolution_instance_name,
        instance_id: instance.instance_id,
        organization_id: orgId,
      });

      const evolutionClient = await import('@/lib/evolution/client');
      const webhookData = await evolutionClient.findWebhook(creds);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const whUrl = (webhookData as any)?.url ?? 'unknown';
      results.step8_evolution_api = {
        connected: true,
        webhook_url: whUrl,
        base_url: creds.baseUrl,
      };
    } catch (err) {
      results.step8_evolution_api = {
        connected: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return NextResponse.json(results);
}
