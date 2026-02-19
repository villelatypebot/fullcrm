/**
 * WhatsApp AI Agent - processes incoming messages and generates responses.
 *
 * This module handles:
 * 1. Receiving incoming WhatsApp messages
 * 2. Checking if AI should respond (active, working hours, etc.)
 * 3. Building context from conversation history + CRM data
 * 4. Generating AI response via configured provider
 * 5. Sending response back via Z-API
 * 6. Auto-creating CRM contacts/deals if configured
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppConversation, WhatsAppAIConfig, WhatsAppMessage } from '@/types/whatsapp';
import { getMessages, insertMessage, insertAILog, getAIConfig, updateConversation } from '@/lib/supabase/whatsapp';
import * as zapi from '@/lib/zapi/client';

interface AIAgentContext {
  supabase: SupabaseClient;
  conversation: WhatsAppConversation;
  instance: {
    id: string;
    instance_id: string;
    instance_token: string;
    client_token?: string;
    organization_id: string;
  };
  incomingMessage: WhatsAppMessage;
}

/**
 * Check if current time is within working hours.
 */
function isWithinWorkingHours(config: WhatsAppAIConfig): boolean {
  if (!config.working_hours_start || !config.working_hours_end) return true;

  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat

  if (!config.working_days.includes(day)) return false;

  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return currentTime >= config.working_hours_start && currentTime <= config.working_hours_end;
}

/**
 * Build conversation context for the AI from recent messages.
 */
async function buildConversationContext(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 20,
): Promise<string> {
  const messages = await getMessages(supabase, conversationId, { limit });

  return messages
    .map((msg) => {
      const sender = msg.from_me ? 'Assistente' : 'Cliente';
      const content = msg.text_body || `[${msg.message_type}]`;
      return `${sender}: ${content}`;
    })
    .join('\n');
}

/**
 * Build CRM context for the AI (contact info, deals, etc.)
 */
async function buildCRMContext(
  supabase: SupabaseClient,
  conversation: WhatsAppConversation,
): Promise<string> {
  const parts: string[] = [];

  if (conversation.contact_id) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('name, email, phone, status, stage, total_value, notes, last_interaction')
      .eq('id', conversation.contact_id)
      .single();

    if (contact) {
      parts.push(`CONTATO CRM: ${contact.name || 'Sem nome'}`);
      if (contact.email) parts.push(`Email: ${contact.email}`);
      if (contact.status) parts.push(`Status: ${contact.status}`);
      if (contact.total_value) parts.push(`Valor total: R$ ${contact.total_value}`);
      if (contact.notes) parts.push(`Notas: ${contact.notes}`);
    }

    // Get open deals
    const { data: deals } = await supabase
      .from('deals')
      .select('title, value, priority, tags, ai_summary, board_stages(label)')
      .eq('contact_id', conversation.contact_id)
      .eq('is_won', false)
      .eq('is_lost', false)
      .limit(5);

    if (deals && deals.length > 0) {
      parts.push('\nNEGÓCIOS ABERTOS:');
      for (const deal of deals) {
        const stage = (deal.board_stages as { label?: string } | null)?.label ?? 'N/A';
        parts.push(`- ${deal.title} | R$ ${deal.value ?? 0} | Estágio: ${stage} | Prioridade: ${deal.priority ?? 'N/A'}`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Generate AI response using configured provider.
 */
async function generateAIResponse(
  supabase: SupabaseClient,
  organizationId: string,
  config: WhatsAppAIConfig,
  conversationHistory: string,
  crmContext: string,
  incomingText: string,
): Promise<string> {
  // Get AI provider settings
  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
    .eq('organization_id', organizationId)
    .single();

  // Also check user-level keys
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
    .eq('user_id', organizationId)
    .maybeSingle();

  const provider = orgSettings?.ai_provider ?? 'google';
  const model = orgSettings?.ai_model ?? 'gemini-2.5-flash';

  let apiKey: string | undefined;
  if (provider === 'google') apiKey = orgSettings?.ai_google_key || userSettings?.ai_google_key;
  else if (provider === 'openai') apiKey = orgSettings?.ai_openai_key || userSettings?.ai_openai_key;
  else if (provider === 'anthropic') apiKey = orgSettings?.ai_anthropic_key || userSettings?.ai_anthropic_key;

  if (!apiKey) {
    return config.transfer_message || 'Um atendente humano irá continuar o atendimento.';
  }

  // Build the prompt
  const systemPrompt = [
    config.system_prompt,
    '',
    `Seu nome: ${config.agent_name}`,
    `Seu papel: ${config.agent_role || 'Atendente virtual'}`,
    `Tom: ${config.agent_tone}`,
    '',
    'REGRAS:',
    '- Responda APENAS em texto simples (sem markdown, sem HTML)',
    '- Seja conciso: mensagens de WhatsApp devem ser curtas',
    '- Máximo de 3 parágrafos curtos por resposta',
    '- Se não souber a resposta, informe que irá encaminhar para um atendente',
    '- Nunca invente informações sobre produtos ou preços',
    crmContext ? `\nCONTEXTO CRM:\n${crmContext}` : '',
  ].filter(Boolean).join('\n');

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...(conversationHistory
      ? conversationHistory.split('\n').map((line) => {
          const isAssistant = line.startsWith('Assistente:');
          return {
            role: isAssistant ? ('assistant' as const) : ('user' as const),
            content: line.replace(/^(Assistente|Cliente): /, ''),
          };
        })
      : []),
    { role: 'user' as const, content: incomingText },
  ];

  // Use the AI SDK to generate response
  const { generateText } = await import('ai');

  let modelInstance;
  if (provider === 'google') {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
    const google = createGoogleGenerativeAI({ apiKey });
    modelInstance = google(model);
  } else if (provider === 'openai') {
    const { createOpenAI } = await import('@ai-sdk/openai');
    const openai = createOpenAI({ apiKey });
    modelInstance = openai(model);
  } else {
    const { createAnthropic } = await import('@ai-sdk/anthropic');
    const anthropic = createAnthropic({ apiKey });
    modelInstance = anthropic(model);
  }

  const result = await generateText({
    model: modelInstance,
    messages,
    maxTokens: 500,
  });

  return result.text || config.transfer_message || 'Desculpe, não consegui processar sua mensagem.';
}

/**
 * Auto-create CRM contact from WhatsApp conversation if configured.
 */
async function autoCreateContact(
  supabase: SupabaseClient,
  conversation: WhatsAppConversation,
  config: WhatsAppAIConfig,
): Promise<string | null> {
  if (!config.auto_create_contact) return null;
  if (conversation.contact_id) return conversation.contact_id;

  // Check if contact already exists by phone
  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('phone', conversation.phone)
    .eq('organization_id', conversation.organization_id)
    .maybeSingle();

  if (existing) {
    // Link to conversation
    await supabase
      .from('whatsapp_conversations')
      .update({ contact_id: existing.id })
      .eq('id', conversation.id);
    return existing.id;
  }

  // Create new contact
  const { data: newContact, error } = await supabase
    .from('contacts')
    .insert({
      name: conversation.contact_name || conversation.phone,
      phone: conversation.phone,
      organization_id: conversation.organization_id,
      source: 'whatsapp',
      status: 'ACTIVE',
    })
    .select('id')
    .single();

  if (error || !newContact) return null;

  // Link to conversation
  await supabase
    .from('whatsapp_conversations')
    .update({ contact_id: newContact.id })
    .eq('id', conversation.id);

  await insertAILog(supabase, {
    conversation_id: conversation.id,
    organization_id: conversation.organization_id,
    action: 'contact_created',
    details: { contact_id: newContact.id, phone: conversation.phone },
    triggered_by: 'ai',
  });

  return newContact.id;
}

/**
 * Auto-create deal for new contact if configured.
 */
async function autoCreateDeal(
  supabase: SupabaseClient,
  conversation: WhatsAppConversation,
  contactId: string,
  config: WhatsAppAIConfig,
): Promise<void> {
  if (!config.auto_create_deal || !config.default_board_id) return;

  // Check if there's already an open deal for this contact on this board
  const { data: existingDeal } = await supabase
    .from('deals')
    .select('id')
    .eq('contact_id', contactId)
    .eq('board_id', config.default_board_id)
    .eq('is_won', false)
    .eq('is_lost', false)
    .maybeSingle();

  if (existingDeal) return;

  const stageId = config.default_stage_id;
  if (!stageId) {
    // Get first stage of the board
    const { data: firstStage } = await supabase
      .from('board_stages')
      .select('id')
      .eq('board_id', config.default_board_id)
      .order('order', { ascending: true })
      .limit(1)
      .single();
    if (!firstStage) return;
  }

  const { data: deal, error } = await supabase
    .from('deals')
    .insert({
      title: `WhatsApp - ${conversation.contact_name || conversation.phone}`,
      board_id: config.default_board_id,
      stage_id: stageId ?? undefined,
      contact_id: contactId,
      organization_id: conversation.organization_id,
      tags: config.default_tags ?? [],
      priority: 'medium',
    })
    .select('id')
    .single();

  if (error || !deal) return;

  await insertAILog(supabase, {
    conversation_id: conversation.id,
    organization_id: conversation.organization_id,
    action: 'deal_created',
    details: { deal_id: deal.id, board_id: config.default_board_id },
    triggered_by: 'ai',
  });
}

/**
 * Main entry point: process an incoming WhatsApp message with the AI agent.
 */
export async function processIncomingMessage(ctx: AIAgentContext): Promise<void> {
  const { supabase, conversation, instance, incomingMessage } = ctx;

  // Get AI config
  const config = await getAIConfig(supabase, instance.id);
  if (!config) return; // No AI config = no AI response

  // Check if AI is active for this conversation
  if (!conversation.ai_active) return;

  // Check working hours
  if (!isWithinWorkingHours(config)) {
    if (config.outside_hours_message) {
      // Send outside-hours message (only once per conversation per day)
      const today = new Date().toISOString().slice(0, 10);
      const { data: existingMsg } = await supabase
        .from('whatsapp_messages')
        .select('id')
        .eq('conversation_id', conversation.id)
        .eq('from_me', true)
        .eq('text_body', config.outside_hours_message)
        .gte('created_at', `${today}T00:00:00`)
        .limit(1);

      if (!existingMsg || existingMsg.length === 0) {
        await sendAIReply(supabase, instance, conversation, config.outside_hours_message);
      }
    }
    return;
  }

  // Auto-create contact
  const contactId = await autoCreateContact(supabase, conversation, config);

  // Auto-create deal
  if (contactId) {
    await autoCreateDeal(supabase, conversation, contactId, config);
  }

  // Check message limit
  if (config.max_messages_per_conversation) {
    const { count } = await supabase
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('sent_by', 'ai_agent');

    if (count && count >= config.max_messages_per_conversation) {
      // Escalate to human
      await updateConversation(supabase, conversation.id, {
        ai_active: false,
        ai_pause_reason: 'message_limit_reached',
      } as Parameters<typeof updateConversation>[2]);

      if (config.transfer_message) {
        await sendAIReply(supabase, instance, conversation, config.transfer_message);
      }

      await insertAILog(supabase, {
        conversation_id: conversation.id,
        organization_id: instance.organization_id,
        action: 'escalated',
        details: { reason: 'message_limit_reached' },
        triggered_by: 'ai',
      });
      return;
    }
  }

  // Build context
  const conversationHistory = await buildConversationContext(supabase, conversation.id);
  const crmContext = await buildCRMContext(supabase, conversation);

  // Check if it's a greeting (first message) and we have a greeting message
  const { count: msgCount } = await supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('from_me', false);

  if (msgCount === 1 && config.greeting_message) {
    await sendAIReply(supabase, instance, conversation, config.greeting_message);
    return;
  }

  // Generate AI response
  const incomingText = incomingMessage.text_body || `[Mensagem do tipo: ${incomingMessage.message_type}]`;

  try {
    const aiResponse = await generateAIResponse(
      supabase,
      instance.organization_id,
      config,
      conversationHistory,
      crmContext,
      incomingText,
    );

    // Apply typing delay
    if (config.reply_delay_ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.reply_delay_ms));
    }

    const msg = await sendAIReply(supabase, instance, conversation, aiResponse);

    await insertAILog(supabase, {
      conversation_id: conversation.id,
      organization_id: instance.organization_id,
      action: 'replied',
      details: { response_length: aiResponse.length },
      message_id: msg?.id,
      triggered_by: 'ai',
    });
  } catch (err) {
    await insertAILog(supabase, {
      conversation_id: conversation.id,
      organization_id: instance.organization_id,
      action: 'error',
      details: { error: err instanceof Error ? err.message : String(err) },
      triggered_by: 'ai',
    });
  }
}

/**
 * Send an AI-generated reply via Z-API and persist it.
 */
async function sendAIReply(
  supabase: SupabaseClient,
  instance: AIAgentContext['instance'],
  conversation: WhatsAppConversation,
  text: string,
): Promise<WhatsAppMessage | null> {
  const creds: zapi.ZApiCredentials = {
    instanceId: instance.instance_id,
    token: instance.instance_token,
    clientToken: instance.client_token,
  };

  try {
    const response = await zapi.sendText(creds, {
      phone: conversation.phone,
      message: text,
    });

    const msg = await insertMessage(supabase, {
      conversation_id: conversation.id,
      organization_id: instance.organization_id,
      zapi_message_id: response.zapiMessageId || response.messageId || response.id || undefined,
      from_me: true,
      message_type: 'text',
      text_body: text,
      status: 'sent',
      sent_by: 'ai_agent',
      whatsapp_timestamp: new Date().toISOString(),
    } as Parameters<typeof insertMessage>[1]);

    return msg;
  } catch {
    return null;
  }
}
