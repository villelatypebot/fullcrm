/**
 * WhatsApp AI Agent v2 - Autonomous Intelligence
 *
 * This module orchestrates the complete AI agent pipeline:
 *
 * 1. Receive incoming WhatsApp message
 * 2. Check if AI should respond (active, working hours, etc.)
 * 3. Run Intelligence Engine (extract intents, memories, score, labels)
 * 4. Save extracted memories
 * 5. Update lead score
 * 6. Auto-assign labels
 * 7. Schedule smart follow-ups if needed
 * 8. Smart-pause if needed (customer wants human, negative sentiment)
 * 9. Build context from conversation history + CRM data + MEMORIES
 * 10. Generate AI response via configured provider
 * 11. Send response back via Evolution API
 * 12. Auto-create CRM contacts/deals if configured
 * 13. Generate conversation summary periodically
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { WhatsAppConversation, WhatsAppAIConfig, WhatsAppMessage, ChatMemory } from '@/types/whatsapp';
import {
  getMessages,
  insertMessage,
  insertAILog,
  getAIConfig,
  updateConversation,
} from '@/lib/supabase/whatsapp';
import {
  getMemories,
  saveExtractedMemories,
  upsertLeadScore,
  getLeadScore,
  assignLabelByName,
  ensureDefaultLabels,
  createFollowUp,
  cancelPendingFollowUps,
  insertSummary,
} from '@/lib/supabase/whatsappIntelligence';
import { analyzeMessage } from '@/lib/evolution/intelligence';
import * as evolution from '@/lib/evolution/client';
import { buildReservationSystemPrompt, buildReservationTools } from './reservationTools';

interface AIAgentContext {
  supabase: SupabaseClient;
  conversation: WhatsAppConversation;
  instance: {
    id: string;
    evolution_instance_name: string;
    instance_token: string;
    organization_id: string;
    evolution_api_url: string;
  };
  incomingMessage: WhatsAppMessage;
}

// =============================================================================
// WORKING HOURS
// =============================================================================

function isWithinWorkingHours(config: WhatsAppAIConfig): boolean {
  if (!config.working_hours_start || !config.working_hours_end) return true;

  // Use São Paulo timezone (UTC-3) — Vercel runs in UTC
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const day = now.getDay();

  if (!config.working_days.includes(day)) return false;

  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  return currentTime >= config.working_hours_start && currentTime <= config.working_hours_end;
}

// =============================================================================
// CONTEXT BUILDERS
// =============================================================================

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

    const { data: deals } = await supabase
      .from('deals')
      .select('title, value, priority, tags, ai_summary, board_stages(label)')
      .eq('contact_id', conversation.contact_id)
      .eq('is_won', false)
      .eq('is_lost', false)
      .limit(5);

    if (deals && deals.length > 0) {
      parts.push('\nNEGOCIOS ABERTOS:');
      for (const deal of deals) {
        const stage = (deal.board_stages as { label?: string } | null)?.label ?? 'N/A';
        parts.push(`- ${deal.title} | R$ ${deal.value ?? 0} | Estagio: ${stage} | Prioridade: ${deal.priority ?? 'N/A'}`);
      }
    }
  }

  return parts.join('\n');
}

function buildMemoryContext(memories: ChatMemory[]): string {
  if (memories.length === 0) return '';

  const parts = ['\nMEMORIAS DO CONTATO (use estas informacoes na conversa):'];

  const grouped = new Map<string, ChatMemory[]>();
  for (const mem of memories) {
    const group = grouped.get(mem.memory_type) || [];
    group.push(mem);
    grouped.set(mem.memory_type, group);
  }

  const typeLabels: Record<string, string> = {
    family: 'Familia',
    preference: 'Preferencias',
    budget: 'Orcamento',
    interest: 'Interesses',
    timeline: 'Prazos/Datas',
    objection: 'Objecoes levantadas',
    personal: 'Info pessoal',
    fact: 'Fatos',
    interaction: 'Estilo de comunicacao',
  };

  for (const [type, mems] of grouped.entries()) {
    parts.push(`\n${typeLabels[type] || type}:`);
    for (const m of mems) {
      parts.push(`  - ${m.key}: ${m.value}`);
    }
  }

  return parts.join('\n');
}

// =============================================================================
// MEDIA PROCESSING (Audio transcription + Image analysis)
// =============================================================================

/**
 * Transcribe audio message using OpenAI Whisper API.
 * Falls back to Google if no OpenAI key available.
 */
async function transcribeAudio(
  supabase: SupabaseClient,
  organizationId: string,
  instance: AIAgentContext['instance'],
  evolutionMessageId: string,
): Promise<string | null> {
  try {
    const creds: evolution.EvolutionCredentials = {
      baseUrl: instance.evolution_api_url,
      apiKey: instance.instance_token,
      instanceName: instance.evolution_instance_name,
    };

    console.log('[ai-agent] Downloading audio for transcription, messageId:', evolutionMessageId);
    const media = await evolution.getBase64FromMedia(creds, evolutionMessageId);
    if (!media?.base64) {
      console.warn('[ai-agent] No base64 audio received from Evolution API');
      return null;
    }

    // Get API keys
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('ai_openai_key, ai_google_key')
      .eq('organization_id', organizationId)
      .single();

    // Try OpenAI Whisper first (best for audio transcription)
    if (orgSettings?.ai_openai_key) {
      console.log('[ai-agent] Transcribing audio with OpenAI Whisper');
      const audioBuffer = Buffer.from(media.base64, 'base64');

      // Create a FormData-like request for OpenAI Whisper API
      const boundary = '----FormBoundary' + Math.random().toString(36).slice(2);
      const ext = media.mimetype?.includes('ogg') ? 'ogg' : 'mp3';
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${media.mimetype || 'audio/ogg'}\r\n\r\n`),
        audioBuffer,
        Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\npt\r\n--${boundary}--\r\n`),
      ]);

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${orgSettings.ai_openai_key}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      });

      if (response.ok) {
        const result = await response.json() as { text: string };
        console.log('[ai-agent] Audio transcribed:', result.text?.slice(0, 100));
        return result.text || null;
      }
      console.warn('[ai-agent] Whisper API failed:', response.status, await response.text().catch(() => ''));
    }

    // Fallback: Use Gemini for audio understanding
    if (orgSettings?.ai_google_key) {
      console.log('[ai-agent] Transcribing audio with Gemini');
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const { generateText } = await import('ai');
      const google = createGoogleGenerativeAI({ apiKey: orgSettings.ai_google_key });

      const result = await generateText({
        model: google('gemini-2.5-flash'),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcreva este áudio em português. Retorne APENAS o texto falado, sem comentários.' },
              {
                type: 'file',
                data: media.base64,
                mimeType: (media.mimetype || 'audio/ogg') as any,
              } as any,
            ],
          },
        ],
      });

      console.log('[ai-agent] Audio transcribed via Gemini:', result.text?.slice(0, 100));
      return result.text || null;
    }

    console.warn('[ai-agent] No API key available for audio transcription');
    return null;
  } catch (err) {
    console.error('[ai-agent] Audio transcription failed:', err);
    return null;
  }
}

/**
 * Analyze an image message using multimodal AI.
 * Returns a description/understanding of the image content.
 */
async function analyzeImage(
  supabase: SupabaseClient,
  organizationId: string,
  instance: AIAgentContext['instance'],
  evolutionMessageId: string,
  caption?: string,
  conversationContext?: string,
): Promise<{ description: string; isRelevant: boolean } | null> {
  try {
    const creds: evolution.EvolutionCredentials = {
      baseUrl: instance.evolution_api_url,
      apiKey: instance.instance_token,
      instanceName: instance.evolution_instance_name,
    };

    console.log('[ai-agent] Downloading image for analysis, messageId:', evolutionMessageId);
    const media = await evolution.getBase64FromMedia(creds, evolutionMessageId);
    if (!media?.base64) {
      console.warn('[ai-agent] No base64 image received from Evolution API');
      return null;
    }

    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('ai_google_key, ai_openai_key')
      .eq('organization_id', organizationId)
      .single();

    const systemPrompt = `Você é a assistente Eshylei da Full House Rodízio de Comida de Festa.
Analise esta imagem enviada por um cliente no WhatsApp.

Contexto da conversa: ${conversationContext || 'Início de conversa'}
${caption ? `Legenda da imagem: ${caption}` : ''}

Responda em JSON com:
- "description": breve descrição do que está na imagem (1-2 frases)
- "isRelevant": true se a imagem é relevante para o atendimento (comprovante de pagamento, foto do evento, print de reserva, cardápio, etc), false se é irrelevante (meme, foto pessoal aleatória, etc)
- "response_suggestion": se relevante, sugira como responder. Se irrelevante, null.

Responda APENAS o JSON, sem markdown.`;

    // Prefer Google for vision (cheaper + supports natively)
    if (orgSettings?.ai_google_key) {
      console.log('[ai-agent] Analyzing image with Gemini');
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      const { generateText } = await import('ai');
      const google = createGoogleGenerativeAI({ apiKey: orgSettings.ai_google_key });

      const result = await generateText({
        model: google('gemini-2.5-flash'),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: systemPrompt },
              {
                type: 'image',
                image: media.base64,
                mimeType: (media.mimetype || 'image/jpeg') as any,
              } as any,
            ],
          },
        ],
      });

      try {
        const parsed = JSON.parse(result.text.replace(/```json\n?|\n?```/g, '').trim());
        return { description: parsed.description, isRelevant: parsed.isRelevant ?? false };
      } catch {
        return { description: result.text, isRelevant: true };
      }
    }

    // Fallback to OpenAI Vision
    if (orgSettings?.ai_openai_key) {
      console.log('[ai-agent] Analyzing image with OpenAI Vision');
      const { createOpenAI } = await import('@ai-sdk/openai');
      const { generateText } = await import('ai');
      const openai = createOpenAI({ apiKey: orgSettings.ai_openai_key });

      const result = await generateText({
        model: openai('gpt-4o-mini'),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: systemPrompt },
              {
                type: 'image',
                image: media.base64,
                mimeType: (media.mimetype || 'image/jpeg') as any,
              } as any,
            ],
          },
        ],
      });

      try {
        const parsed = JSON.parse(result.text.replace(/```json\n?|\n?```/g, '').trim());
        return { description: parsed.description, isRelevant: parsed.isRelevant ?? false };
      } catch {
        return { description: result.text, isRelevant: true };
      }
    }

    return null;
  } catch (err) {
    console.error('[ai-agent] Image analysis failed:', err);
    return null;
  }
}

// =============================================================================
// AI RESPONSE GENERATOR
// =============================================================================

async function generateAIResponse(
  supabase: SupabaseClient,
  organizationId: string,
  config: WhatsAppAIConfig,
  conversationHistory: string,
  crmContext: string,
  memoryContext: string,
  incomingText: string,
  customerInfo: { phone: string; name: string }
): Promise<string> {
  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
    .eq('organization_id', organizationId)
    .single();

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
    return config.transfer_message || 'Um atendente humano ira continuar o atendimento.';
  }

  // Current date/time in São Paulo timezone
  const now = new Date();
  const spFormatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
  const currentDateTimeSP = spFormatter.format(now);

  const systemPrompt = [
    config.system_prompt,
    '',
    `Seu nome: ${config.agent_name}`,
    `Seu papel: ${config.agent_role || 'Atendente virtual'}`,
    `Tom: ${config.agent_tone}`,
    `Data e hora atual: ${currentDateTimeSP} (horário de Brasília)`,
    `Ano atual: ${now.getFullYear()}`,
    '',
    'REGRAS:',
    '- Responda APENAS em texto simples (sem formatação, asteriscos ou emojis em excesso)',
    '- Seja conciso, mas divida bem o texto: QUEBRE sua resposta em 2 ou 3 parágrafos curtos. NUNCA envie um "blocão" único de texto',
    '- Se nao souber a resposta, informe que ira encaminhar para um atendente',
    '- Nunca invente informacoes sobre produtos ou precos',
    '- USE AS MEMORIAS DO CONTATO para personalizar a conversa',
    '- Se o cliente mencionou o nome de alguem (esposo, filha, etc), use o nome na conversa',
    '- Seja natural e humano, nao robotico',
    '- NUNCA colete dados de reserva (nome, data, horário, etc) pelo WhatsApp. Para reservas, SEMPRE direcione ao link: https://fullhouseagendamento.vercel.app',
    '- Quando o assunto for reserva, use as ferramentas (tools) para consultar disponibilidade e depois envie o link',
    crmContext ? `\nCONTEXTO CRM:\n${crmContext}` : '',
    memoryContext || '',
  ].filter(Boolean).join('\n');

  // Add reservation context if configured
  const reservationContext = await buildReservationSystemPrompt(supabase, organizationId);
  const fullSystemPrompt = reservationContext
    ? `${systemPrompt}\n\n${reservationContext}`
    : systemPrompt;

  const messages = [
    { role: 'system' as const, content: fullSystemPrompt },
    ...(conversationHistory
      ? conversationHistory.split('\n')
          .filter(line => line.trim().length > 0)
          .map((line) => {
            const isAssistant = line.startsWith('Assistente:');
            const content = line.replace(/^(Assistente|Cliente): /, '').trim();
            return {
              role: isAssistant ? ('assistant' as const) : ('user' as const),
              content: content || '...',
            };
          })
          .filter(msg => msg.content.length > 0)
      : []),
    ...(incomingText?.trim() ? [{ role: 'user' as const, content: incomingText.trim() }] : []),
  ];

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

  const reservationTools = await buildReservationTools(supabase, organizationId, customerInfo);
  const hasTools = Object.keys(reservationTools).length > 0;

  console.log('[ai-agent] Calling generateText with provider:', provider, 'model:', model, 'hasTools:', hasTools);

  // Some preview models don't support tools well — try with tools first, fall back without
  let result;
  try {
    result = await generateText({
      model: modelInstance,
      messages,
      ...(hasTools ? { maxSteps: 5, tools: reservationTools } : {}),
    } as any);
  } catch (toolErr) {
    console.warn('[ai-agent] generateText with tools failed, retrying without tools:', toolErr instanceof Error ? toolErr.message : String(toolErr));
    // Retry without tools
    result = await generateText({
      model: modelInstance,
      messages,
    } as any);
  }

  console.log('[ai-agent] generateText result - text length:', result.text?.length ?? 0,
    'steps:', (result as any).steps?.length ?? 0,
    'toolCalls:', (result as any).toolCalls?.length ?? 0,
    'toolResults:', (result as any).toolResults?.length ?? 0);

  // If result.text is empty (e.g., model ended on a tool call without final text),
  // try to extract a meaningful response from the last step's text or tool results
  if (result.text) {
    return result.text;
  }

  // Check if there are step results with text
  const steps = (result as any).steps as Array<{ text?: string; toolResults?: Array<{ output: unknown; result: unknown }> }> | undefined;
  if (steps && steps.length > 0) {
    // Find the last step with text
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i].text && (steps[i].text as string).trim().length > 0) {
        return steps[i].text as string;
      }
    }

    // If no text in any step, build a response from tool results
    // AI SDK v6 uses `output` field, older versions use `result`
    const lastToolResults = steps.flatMap(s => s.toolResults || []);
    if (lastToolResults.length > 0) {
      const lastEntry = lastToolResults[lastToolResults.length - 1];
      // AI SDK v6 stores tool output in `output`, fallback to `result` for compat
      const rawOutput = (lastEntry as any)?.output ?? lastEntry?.result;
      const lastResult: Record<string, unknown> | undefined =
        typeof rawOutput === 'string' ? JSON.parse(rawOutput) :
        typeof rawOutput === 'object' && rawOutput !== null ? rawOutput as Record<string, unknown> :
        undefined;

      if (!lastResult) {
        console.warn('[ai-agent] Tool result is undefined/empty');
      } else {
        console.log('[ai-agent] No text from model, using tool output:', JSON.stringify(lastResult).slice(0, 200));

        // Helper: format YYYY-MM-DD to dd/mm/yyyy
        const formatDate = (d: string) => {
          const parts = String(d).split('-');
          if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
          return d;
        };

        // Build a meaningful fallback from tool data
        if (lastResult.available === true && lastResult.booking_link) {
          const slots = (lastResult.available_time_slots as Array<{ time: string; available_pax_capacity: number }>) || [];
          const slotsText = slots.map(s => s.time).join(', ');
          const dateFormatted = formatDate(lastResult.date as string);
          return `Temos disponibilidade na ${lastResult.unit_name} no dia ${dateFormatted}! Horários: ${slotsText}.\n\nPara fazer sua reserva, acesse:\n${lastResult.booking_link}`;
        } else if (lastResult.available === false) {
          return (lastResult.message as string) || 'Infelizmente não há disponibilidade nessa data. Gostaria de consultar outra data ou unidade?';
        } else if (lastResult.has_reservations === true) {
          const res = (lastResult.reservations as Array<{ date: string; time: string; unit_name: string }>) || [];
          const resText = res.map(r => `${formatDate(r.date)} às ${r.time} na ${r.unit_name}`).join('; ');
          return `Encontrei sua(s) reserva(s): ${resText}. Qualquer dúvida, estou aqui!`;
        }
      }
    }
  }

  console.warn('[ai-agent] generateText returned empty text, no usable steps. Full result keys:', Object.keys(result));
  return config.transfer_message || 'Desculpe, nao consegui processar sua mensagem.';
}

// =============================================================================
// AUTO-CREATE CRM ENTITIES
// =============================================================================

async function autoCreateContact(
  supabase: SupabaseClient,
  conversation: WhatsAppConversation,
  config: WhatsAppAIConfig,
): Promise<string | null> {
  if (!config.auto_create_contact) return null;
  if (conversation.contact_id) return conversation.contact_id;

  const { data: existing } = await supabase
    .from('contacts')
    .select('id')
    .eq('phone', conversation.phone)
    .eq('organization_id', conversation.organization_id)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('whatsapp_conversations')
      .update({ contact_id: existing.id })
      .eq('id', conversation.id);
    return existing.id;
  }

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

async function autoCreateDeal(
  supabase: SupabaseClient,
  conversation: WhatsAppConversation,
  contactId: string,
  config: WhatsAppAIConfig,
): Promise<void> {
  if (!config.auto_create_deal || !config.default_board_id) return;

  const { data: existingDeal } = await supabase
    .from('deals')
    .select('id')
    .eq('contact_id', contactId)
    .eq('board_id', config.default_board_id)
    .eq('is_won', false)
    .eq('is_lost', false)
    .maybeSingle();

  if (existingDeal) return;

  let stageId = config.default_stage_id;
  if (!stageId) {
    const { data: firstStage } = await supabase
      .from('board_stages')
      .select('id')
      .eq('board_id', config.default_board_id)
      .order('order', { ascending: true })
      .limit(1)
      .single();
    if (!firstStage) return;
    stageId = firstStage.id;
  }

  const { data: deal, error } = await supabase
    .from('deals')
    .insert({
      title: `WhatsApp - ${conversation.contact_name || conversation.phone}`,
      board_id: config.default_board_id,
      stage_id: stageId,
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

// =============================================================================
// MAIN ENTRY POINT
// =============================================================================

export async function processIncomingMessage(ctx: AIAgentContext): Promise<void> {
  const { supabase, conversation, instance, incomingMessage } = ctx;

  const config = await getAIConfig(supabase, instance.id);
  if (!config) return;

  if (!conversation.ai_active) return;

  // -- DEBOUNCE via latest message ID --
  // We save the ID of the message that triggered THIS webhook.
  // After waiting, we check if a NEWER customer message arrived.
  // If so, that newer webhook will handle processing — we bail out.
  const triggerMessageId = incomingMessage.id;

  // Wait 5 seconds for message batching (short enough to stay within Vercel limits)
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Re-fetch conversation to get latest state
  const { data: freshConv } = await supabase
    .from('whatsapp_conversations')
    .select('*')
    .eq('id', conversation.id)
    .single();

  if (!freshConv || !freshConv.ai_active) return;

  // Check if a newer customer message arrived after ours
  const { data: newerMessages } = await supabase
    .from('whatsapp_messages')
    .select('id')
    .eq('conversation_id', conversation.id)
    .eq('from_me', false)
    .gt('created_at', incomingMessage.created_at || new Date().toISOString())
    .limit(1);

  if (newerMessages && newerMessages.length > 0) {
    console.log('[ai-agent] Newer message arrived, deferring to its webhook', conversation.id);
    return;
  }

  try {
    await _executeAIAfterBatch(ctx, freshConv as WhatsAppConversation, config);
  } catch (e) {
    console.error('[ai-agent] Batch execution failed:', e);
    // Log error to DB so we can see it
    await insertAILog(supabase, {
      conversation_id: conversation.id,
      organization_id: instance.organization_id,
      action: 'error',
      details: { error: e instanceof Error ? e.message : String(e), phase: 'batch_execution' },
      triggered_by: 'ai',
    });
  }
}

async function _executeAIAfterBatch(ctx: AIAgentContext, conversation: WhatsAppConversation, config: WhatsAppAIConfig): Promise<void> {
  const { supabase, instance } = ctx;

  // Check working hours
  if (!isWithinWorkingHours(config)) {
    if (config.outside_hours_message) {
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

    // Sync existing lead score to newly linked contact
    const existingLeadScore = await getLeadScore(supabase, conversation.id);
    if (existingLeadScore && (!existingLeadScore.contact_id || existingLeadScore.contact_id !== contactId)) {
      await supabase
        .from('whatsapp_lead_scores')
        .update({ contact_id: contactId })
        .eq('conversation_id', conversation.id);

      await supabase
        .from('contacts')
        .update({
          temperature: existingLeadScore.temperature,
          lead_score: existingLeadScore.score,
          buying_stage: existingLeadScore.buying_stage,
        })
        .eq('id', contactId);
    }
  }

  // =========================================================================
  // INTELLIGENCE ENGINE - The magic happens here
  // =========================================================================

  // Fetch all unread messages from the customer to form the complete "incomingText"
  const { data: recentMsgs } = await supabase
    .from('whatsapp_messages')
    .select('text_body, message_type, media_url, media_caption, evolution_message_id')
    .eq('conversation_id', conversation.id)
    .eq('from_me', false)
    .order('created_at', { ascending: false })
    .limit(conversation.unread_count || 1);

  // Process media messages (audio/image) to extract text content
  const textParts: string[] = [];
  let imageAnalysisResult: { description: string; isRelevant: boolean } | null = null;

  if (recentMsgs) {
    for (const msg of recentMsgs.reverse()) {
      if (msg.text_body) {
        textParts.push(msg.text_body);
      } else if (msg.message_type === 'audio' && msg.evolution_message_id) {
        // Transcribe audio
        const transcription = await transcribeAudio(
          supabase, instance.organization_id, instance, msg.evolution_message_id,
        );
        if (transcription) {
          textParts.push(transcription);
          // Update the message in DB with the transcription
          await supabase.from('whatsapp_messages')
            .update({ text_body: `[Áudio transcrito]: ${transcription}` })
            .eq('evolution_message_id', msg.evolution_message_id)
            .eq('conversation_id', conversation.id);
          console.log('[ai-agent] Audio transcribed and saved:', transcription.slice(0, 80));
        } else {
          textParts.push('[Cliente enviou um áudio que não pôde ser transcrito]');
        }
      } else if (msg.message_type === 'image' && msg.evolution_message_id) {
        // Analyze image
        const conversationHistory = await buildConversationContext(supabase, conversation.id);
        imageAnalysisResult = await analyzeImage(
          supabase, instance.organization_id, instance,
          msg.evolution_message_id, msg.media_caption || undefined, conversationHistory,
        );
        if (imageAnalysisResult) {
          if (imageAnalysisResult.isRelevant) {
            textParts.push(`[Cliente enviou uma imagem: ${imageAnalysisResult.description}]`);
          } else {
            textParts.push(`[Cliente enviou uma imagem irrelevante: ${imageAnalysisResult.description}]`);
          }
          if (msg.media_caption) textParts.push(msg.media_caption);
          console.log('[ai-agent] Image analyzed:', imageAnalysisResult.description.slice(0, 80), 'relevant:', imageAnalysisResult.isRelevant);
        } else {
          textParts.push('[Cliente enviou uma imagem]');
          if (msg.media_caption) textParts.push(msg.media_caption);
        }
      } else if (msg.media_caption) {
        textParts.push(msg.media_caption);
      }
    }
  }

  // Group multiple messages safely into a single conceptual paragraph for the AI
  const incomingText = textParts.filter(Boolean).join('\n');

  // Run intelligence and generate response for any processed content
  if (incomingText) {
    const conversationHistory = await buildConversationContext(supabase, conversation.id);
    const existingMemories = await getMemories(supabase, conversation.id);

    const intelligence = await analyzeMessage(
      supabase,
      instance.organization_id,
      conversationHistory,
      incomingText,
      existingMemories,
      config,
    );

    // 1. Save extracted memories
    if (config.memory_enabled && intelligence.memories.length > 0) {
      await saveExtractedMemories(
        supabase,
        conversation.id,
        instance.organization_id,
        contactId ?? undefined,
        intelligence.memories,
        ctx.incomingMessage.id, // Fallback pointing to the trigger message
      );

      await insertAILog(supabase, {
        conversation_id: conversation.id,
        organization_id: instance.organization_id,
        action: 'memory_extracted',
        details: { count: intelligence.memories.length, keys: intelligence.memories.map((m) => m.key) },
        message_id: ctx.incomingMessage.id,
        triggered_by: 'ai',
      });
    }

    // 2. Update lead score
    if (config.lead_scoring_enabled && intelligence.lead_score_delta !== 0) {
      const score = await upsertLeadScore(
        supabase,
        conversation.id,
        instance.organization_id,
        contactId ?? undefined,
        intelligence.lead_score_delta,
        undefined,
        intelligence.buying_stage,
      );

      await insertAILog(supabase, {
        conversation_id: conversation.id,
        organization_id: instance.organization_id,
        action: 'lead_score_updated',
        details: {
          delta: intelligence.lead_score_delta,
          new_score: score.score,
          temperature: score.temperature,
        },
        triggered_by: 'ai',
      });
    }

    // 3. Auto-assign labels
    if (config.auto_label_enabled && intelligence.suggested_labels.length > 0) {
      await ensureDefaultLabels(supabase, instance.organization_id);

      for (const labelName of intelligence.suggested_labels) {
        const assigned = await assignLabelByName(
          supabase,
          conversation.id,
          instance.organization_id,
          labelName,
          'ai',
          `Intent: ${intelligence.intents.map((i) => i.intent).join(', ')}`,
        );

        if (assigned) {
          await insertAILog(supabase, {
            conversation_id: conversation.id,
            organization_id: instance.organization_id,
            action: 'label_assigned',
            details: { label: labelName },
            triggered_by: 'ai',
          });
        }
      }
    }

    // 4. Schedule follow-ups
    if (config.follow_up_enabled) {
      const followUpIntents = intelligence.intents.filter(
        (i) => i.follow_up_delay_minutes && i.follow_up_delay_minutes > 0,
      );

      if (followUpIntents.length > 0) {
        // Cancel any existing pending follow-ups before scheduling new ones
        await cancelPendingFollowUps(supabase, conversation.id);

        // Use the highest-confidence intent for the follow-up
        const primaryIntent = followUpIntents.sort((a, b) => b.confidence - a.confidence)[0];

        // Use configured sequence STRICTLY - never AI intent delays
        const sequence = Array.isArray(config.follow_up_sequence)
          ? config.follow_up_sequence as Array<{ delay_minutes: number; label: string }>
          : [];
        const maxFollowUps = sequence.length > 0
          ? Math.min(sequence.length, config.follow_up_max_per_conversation ?? 3)
          : 1;
        const delayMinutes = sequence[0]?.delay_minutes
          ?? config.follow_up_default_delay_minutes ?? 30;

        const triggerAt = new Date(Date.now() + delayMinutes * 60 * 1000);

        await createFollowUp(supabase, {
          conversation_id: conversation.id,
          organization_id: instance.organization_id,
          instance_id: instance.id,
          trigger_at: triggerAt.toISOString(),
          follow_up_type: 'smart',
          detected_intent: primaryIntent.intent,
          intent_confidence: primaryIntent.confidence,
          context: {
            ...primaryIntent.context,
            customer_name: conversation.contact_name || '',
            context_for_message: intelligence.summary || '',
            sequence_index: 0,
            total_steps: maxFollowUps,
          },
          original_customer_message: incomingText,
          original_message_id: ctx.incomingMessage.id,
        });

        await insertAILog(supabase, {
          conversation_id: conversation.id,
          organization_id: instance.organization_id,
          action: 'follow_up_scheduled',
          details: {
            intent: primaryIntent.intent,
            trigger_at: triggerAt.toISOString(),
            delay_minutes: delayMinutes,
            sequence_step: 0,
            total_steps: maxFollowUps,
          },
          message_id: ctx.incomingMessage.id,
          triggered_by: 'ai',
        });
      }
    }

    // 5. Smart pause
    if (config.smart_pause_enabled && intelligence.should_pause) {
      await updateConversation(supabase, conversation.id, {
        ai_active: false,
        ai_pause_reason: intelligence.pause_reason || 'smart_pause',
      } as Parameters<typeof updateConversation>[2]);

      if (config.transfer_message) {
        await sendAIReply(supabase, instance, conversation, config.transfer_message);
      }

      await insertAILog(supabase, {
        conversation_id: conversation.id,
        organization_id: instance.organization_id,
        action: 'smart_paused',
        details: { reason: intelligence.pause_reason },
        triggered_by: 'ai',
      });

      return; // Don't send AI response, human will handle
    }
  }

  // =========================================================================
  // RESPONSE GENERATION
  // =========================================================================

  // Check message limit
  if (config.max_messages_per_conversation) {
    const { count } = await supabase
      .from('whatsapp_messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversation.id)
      .eq('sent_by', 'ai_agent');

    if (count && count >= config.max_messages_per_conversation) {
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

  // Build context (with memories!)
  const conversationHistory = await buildConversationContext(supabase, conversation.id);
  const crmContext = await buildCRMContext(supabase, conversation);
  const memories = await getMemories(supabase, conversation.id);
  const memoryContext = buildMemoryContext(memories);

  // Check if greeting
  const { count: msgCount } = await supabase
    .from('whatsapp_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversation.id)
    .eq('from_me', false);

  if (msgCount === 1 && config.greeting_message) {
    await sendAIReply(supabase, instance, conversation, config.greeting_message);
    return;
  }

  // Generate AI response with FULL context (memories included!)
  const organizationId = instance.organization_id;
  const historyString = conversationHistory;
  const incomingMessage = ctx.incomingMessage;

  try {
    console.log('[ai-agent] Generating AI response for', conversation.phone, 'provider:', config.system_prompt ? 'has_prompt' : 'no_prompt');

    const aiResponse = await generateAIResponse(
      supabase,
      organizationId,
      config,
      historyString,
      crmContext,
      memoryContext,
      incomingText || (incomingMessage as any).text_body || '',
      { phone: conversation.phone, name: conversation.contact_name || 'Cliente WhatsApp' }
    );

    console.log('[ai-agent] AI response generated, length:', aiResponse.length);

    if (config.reply_delay_ms > 0) {
      await new Promise((resolve) => setTimeout(resolve, config.reply_delay_ms));
    }

    const msg = await sendAIReply(supabase, instance, conversation, aiResponse);

    console.log('[ai-agent] Reply sent to', conversation.phone, 'msg_id:', msg?.id);

    await insertAILog(supabase, {
      conversation_id: conversation.id,
      organization_id: instance.organization_id,
      action: 'replied',
      details: { response_length: aiResponse.length },
      message_id: msg?.id,
      triggered_by: 'ai',
    });

    // Generate summary periodically (every 10 messages)
    if (config.summary_enabled && msgCount && msgCount % 10 === 0) {
      generateAndSaveSummary(supabase, conversation, instance.organization_id, conversationHistory, memories).catch(
        (err) => console.error('[ai-agent] Summary generation failed:', err),
      );
    }
  } catch (err) {
    console.error('[ai-agent] generateAIResponse FAILED:', err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? (err.stack || '').slice(0, 300) : undefined;

    await insertAILog(supabase, {
      conversation_id: conversation.id,
      organization_id: instance.organization_id,
      action: 'error',
      details: { error: errorMsg, stack: errorStack },
      triggered_by: 'ai',
    });

    // Send a graceful fallback reply so the customer doesn't get silence
    try {
      const fallback = config.transfer_message || 'Oi! Estou com uma instabilidade no momento. Pode repetir sua mensagem em alguns segundos? 😊';
      await sendAIReply(supabase, instance, conversation, fallback);
    } catch { /* ignore send errors */ }
  }
}

// =============================================================================
// SEND REPLY
// =============================================================================

/**
 * Split text into chunks of max 2 paragraphs each.
 * A paragraph is separated by double newline (\n\n).
 */
function splitIntoParagraphChunks(text: string, maxParagraphsPerChunk = 2): string[] {
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);

  if (paragraphs.length <= maxParagraphsPerChunk) {
    return [text.trim()];
  }

  const chunks: string[] = [];
  for (let i = 0; i < paragraphs.length; i += maxParagraphsPerChunk) {
    const chunk = paragraphs.slice(i, i + maxParagraphsPerChunk).join('\n\n');
    chunks.push(chunk.trim());
  }

  return chunks;
}

async function sendAIReply(
  supabase: SupabaseClient,
  instance: AIAgentContext['instance'],
  conversation: WhatsAppConversation,
  text: string,
): Promise<WhatsAppMessage | null> {
  const creds: evolution.EvolutionCredentials = {
    baseUrl: instance.evolution_api_url,
    apiKey: instance.instance_token,
    instanceName: instance.evolution_instance_name,
  };

  try {
    // Split into chunks of max 2 paragraphs
    const chunks = splitIntoParagraphChunks(text, 2);
    let lastMsg: WhatsAppMessage | null = null;

    for (let i = 0; i < chunks.length; i++) {
      // Delay 5 seconds between chunks (not before the first one)
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }

      const response = await evolution.sendText(creds, {
        number: conversation.phone,
        text: chunks[i],
      });

      const msg = await insertMessage(supabase, {
        conversation_id: conversation.id,
        organization_id: instance.organization_id,
        evolution_message_id: response.key?.id || undefined,
        from_me: true,
        message_type: 'text',
        text_body: chunks[i],
        status: 'sent',
        sent_by: 'ai_agent',
        whatsapp_timestamp: new Date().toISOString(),
      } as Parameters<typeof insertMessage>[1]);

      lastMsg = msg;
    }

    // Update conversation metadata with the last chunk sent
    const lastChunk = chunks[chunks.length - 1] || text || '';
    await updateConversation(supabase, conversation.id, {
      last_message_text: lastChunk.slice(0, 255),
      last_message_at: new Date().toISOString(),
      last_message_from_me: true,
    } as Parameters<typeof updateConversation>[2]);

    return lastMsg;
  } catch (err) {
    console.error('[ai-agent] sendAIReply FAILED for', conversation.phone, ':', err);
    return null;
  }
}

// =============================================================================
// SUMMARY GENERATOR
// =============================================================================

async function generateAndSaveSummary(
  supabase: SupabaseClient,
  conversation: WhatsAppConversation,
  organizationId: string,
  conversationHistory: string,
  memories: ChatMemory[],
): Promise<void> {
  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
    .eq('organization_id', organizationId)
    .single();

  const provider = orgSettings?.ai_provider ?? 'google';
  const model = orgSettings?.ai_model ?? 'gemini-2.5-flash';

  let apiKey: string | undefined;
  if (provider === 'google') apiKey = orgSettings?.ai_google_key;
  else if (provider === 'openai') apiKey = orgSettings?.ai_openai_key;
  else if (provider === 'anthropic') apiKey = orgSettings?.ai_anthropic_key;

  if (!apiKey) return;

  const prompt = `Resuma esta conversa de WhatsApp em 2-3 frases. Identifique pontos-chave e proximas acoes recomendadas.

MEMORIAS:
${memories.map((m) => `- ${m.key}: ${m.value}`).join('\n')}

CONVERSA:
${conversationHistory}

Responda em JSON:
{"summary":"...","key_points":["..."],"next_actions":["..."],"sentiment":"positive|neutral|negative"}`;

  try {
    const { generateText } = await import('ai');

    let modelInstance;
    if (provider === 'google') {
      const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
      modelInstance = createGoogleGenerativeAI({ apiKey })(model);
    } else if (provider === 'openai') {
      const { createOpenAI } = await import('@ai-sdk/openai');
      modelInstance = createOpenAI({ apiKey })(model);
    } else {
      const { createAnthropic } = await import('@ai-sdk/anthropic');
      modelInstance = createAnthropic({ apiKey })(model);
    }

    const result = await generateText({
      model: modelInstance,
      messages: [{ role: 'user', content: prompt }],
      maxOutputTokens: 500,
    });

    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const parsed = JSON.parse(jsonMatch[0]);

    await insertSummary(supabase, {
      conversation_id: conversation.id,
      organization_id: organizationId,
      summary: parsed.summary || 'Sem resumo disponivel.',
      key_points: parsed.key_points || [],
      next_actions: parsed.next_actions || [],
      customer_sentiment: parsed.sentiment || 'neutral',
      trigger_reason: 'periodic',
    });
  } catch {
    // Summary is non-critical, ignore errors
  }
}
