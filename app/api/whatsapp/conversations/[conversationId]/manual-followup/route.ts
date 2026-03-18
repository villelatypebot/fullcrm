import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { generateFollowUpMessage } from '@/lib/evolution/intelligence';
import { sendText } from '@/lib/evolution/client';
import { insertMessage, updateConversation } from '@/lib/supabase/whatsapp';

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const { conversationId } = await params;
    
    // We expect the user to be authenticated
    const supabaseClient = await createClient();
    const { data: { session } } = await supabaseClient.auth.getSession();
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createStaticAdminClient();

    // 1. Get Conversation and Instance details
    const { data: conversation, error: convErr } = await supabase
      .from('whatsapp_conversations')
      .select('*, whatsapp_instances(*)')
      .eq('id', conversationId)
      .single();

    if (convErr || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const instance = Array.isArray(conversation.whatsapp_instances)
      ? conversation.whatsapp_instances[0]
      : conversation.whatsapp_instances;

    if (!instance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const orgId = conversation.organization_id;

    // 2. Fetch config & settings
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('evolution_api_url')
      .eq('organization_id', orgId)
      .single();

    const { data: config } = await supabase
      .from('whatsapp_ai_configs')
      .select('*')
      .eq('instance_id', instance.id)
      .single();

    if (!config) {
      return NextResponse.json({ error: 'AI config not found' }, { status: 400 });
    }

    // 3. Fake a follow-up request payload to trick the generator
    const fakeFollowUp = {
      id: crypto.randomUUID(), // fake id for logs
      conversation_id: conversationId,
      organization_id: orgId,
      instance_id: instance.id,
      trigger_at: new Date().toISOString(),
      status: 'pending' as const,
      detected_intent: 'manual_trigger',
      follow_up_type: 'time_based' as any,
      created_by: 'system',
      context: { sequence_index: 0, total_steps: 1 },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      max_retries: 3,
      retry_count: 0
    };

    // 4. Fetch memories and generate the message using AI (which already builds history & memories)
    const { data: memories } = await supabase
      .from('whatsapp_chat_memories')
      .select('*')
      .eq('conversation_id', conversationId);

    const aiMessage = await generateFollowUpMessage(
      supabase,
      orgId,
      fakeFollowUp,
      conversation.contact_name || conversation.phone,
      memories || [],
      config
    );

    // 5. Send it via Evolution
    const apiUrl = orgSettings?.evolution_api_url;
    if (!apiUrl) throw new Error('Evolution API URL not configured');

    const sentMsg = await sendText(
      {
        instanceName: instance.evolution_instance_name || instance.instance_id,
        baseUrl: apiUrl,
        apiKey: instance.instance_token,
      },
      {
        number: conversation.phone,
        text: aiMessage,
      }
    );

    // 6. Save sent message to DB
    await insertMessage(supabase, {
      conversation_id: conversationId,
      organization_id: orgId,
      evolution_message_id: sentMsg?.key?.id || crypto.randomUUID(),
      from_me: true,
      sender_name: 'AI Agent (Manual)',
      message_type: 'text',
      text_body: aiMessage,
      status: 'sent',
      whatsapp_timestamp: new Date().toISOString(),
    } as any);

    // 7. Update conversation last message status
    await updateConversation(supabase, conversationId, {
      last_message_text: aiMessage.slice(0, 255),
      last_message_at: new Date().toISOString(),
      last_message_from_me: true,
      status: 'open',
    } as any);

    // 8. Log the manual action
    await supabase.from('ai_logs').insert({
      conversation_id: conversationId,
      organization_id: orgId,
      action: 'manual_followup',
      details: { text: aiMessage },
      triggered_by: 'user',
    });

    return NextResponse.json({ ok: true, message: aiMessage });
  } catch (error: any) {
    console.error('[manual-followup] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Error' }, { status: 500 });
  }
}
