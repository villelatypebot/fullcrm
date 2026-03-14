import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getAIConfig, getMessages } from '@/lib/supabase/whatsapp';
import { getMemories } from '@/lib/supabase/whatsappIntelligence';
import { processIncomingMessage } from '@/lib/evolution/aiAgent';

/**
 * Test endpoint - manually triggers AI pipeline for a conversation.
 * POST /api/whatsapp/test-ai?conversationId=xxx
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  const url = new URL(request.url);
  const phone = url.searchParams.get('phone') || '5521996056963';
  const orgId = profile.organization_id;
  const adminSupabase = createStaticAdminClient();
  const results: Record<string, unknown> = {};

  try {
    // Step 1: Find conversation
    const { data: conversation, error: convErr } = await adminSupabase
      .from('whatsapp_conversations')
      .select('*')
      .eq('organization_id', orgId)
      .eq('phone', phone)
      .single();

    if (!conversation) {
      return NextResponse.json({ error: 'Conversation not found', convErr: convErr?.message });
    }
    results.conversation = {
      id: conversation.id,
      ai_active: conversation.ai_active,
      instance_id: conversation.instance_id,
    };

    // Step 2: Find instance
    const { data: instance } = await adminSupabase
      .from('whatsapp_instances')
      .select('*')
      .eq('id', conversation.instance_id)
      .single();

    if (!instance) {
      return NextResponse.json({ ...results, error: 'Instance not found' });
    }
    results.instance = {
      id: instance.id,
      ai_enabled: instance.ai_enabled,
      evolution_instance_name: instance.evolution_instance_name,
    };

    // Step 3: Get evolution_api_url
    const { data: orgSettings } = await adminSupabase
      .from('organization_settings')
      .select('evolution_api_url')
      .eq('organization_id', orgId)
      .single();

    results.evolution_api_url = orgSettings?.evolution_api_url || 'MISSING!';

    // Step 4: Get the last incoming message
    const messages = await getMessages(adminSupabase, conversation.id, { limit: 5 });
    const lastIncoming = messages.filter(m => !m.from_me).pop();
    results.last_incoming = lastIncoming ? {
      id: lastIncoming.id,
      text: lastIncoming.text_body,
      created_at: lastIncoming.created_at,
    } : 'NO INCOMING MESSAGES';

    if (!lastIncoming) {
      return NextResponse.json({ ...results, error: 'No incoming messages found' });
    }

    // Step 5: Try to run processIncomingMessage
    results.attempting_ai = true;

    await processIncomingMessage({
      supabase: adminSupabase,
      conversation,
      instance: {
        id: instance.id,
        evolution_instance_name: instance.evolution_instance_name || instance.instance_id,
        instance_token: instance.instance_token,
        organization_id: orgId,
        evolution_api_url: orgSettings?.evolution_api_url || '',
      },
      incomingMessage: lastIncoming,
    });

    results.ai_result = 'SUCCESS - processIncomingMessage completed without error';
  } catch (err) {
    results.ai_error = {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.split('\n').slice(0, 5) : undefined,
    };
  }

  return NextResponse.json(results);
}
