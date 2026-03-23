/**
 * TEMPORARY endpoint to test the AI reply pipeline without WhatsApp.
 * DELETE after confirming the fix works.
 *
 * Usage: GET /api/test-ai-reply?msg=Tem+vaga+na+Boa+Vista+dia+28
 */
import { NextResponse } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { getAIConfig } from '@/lib/supabase/whatsapp';
import { getMemories } from '@/lib/supabase/whatsappIntelligence';
import { buildReservationSystemPrompt, buildReservationTools } from '@/lib/evolution/reservationTools';

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const msg = searchParams.get('msg') || 'Oi, boa tarde!';
  const orgId = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';
  const instanceId = '89dffb0e-2053-4ec4-b188-0eabed05a879';
  const conversationId = '79b204fd-dfef-4afd-b8a3-6994accbb064';

  const supabase = createStaticAdminClient();

  try {
    // 1. Get AI config
    const config = await getAIConfig(supabase, instanceId);
    if (!config) return NextResponse.json({ error: 'No AI config' });

    // 2. Get org settings
    const { data: orgSettings } = await supabase
      .from('organization_settings')
      .select('ai_provider, ai_model, ai_google_key, ai_openai_key, ai_anthropic_key')
      .eq('organization_id', orgId)
      .single();

    const provider = orgSettings?.ai_provider ?? 'google';
    const model = orgSettings?.ai_model ?? 'gemini-2.5-pro';
    let apiKey: string | undefined;
    if (provider === 'google') apiKey = orgSettings?.ai_google_key;
    else if (provider === 'openai') apiKey = orgSettings?.ai_openai_key;
    else if (provider === 'anthropic') apiKey = orgSettings?.ai_anthropic_key;

    if (!apiKey) return NextResponse.json({ error: 'No API key for provider: ' + provider });

    // 3. Build conversation history (last 5 messages)
    const { data: recentMsgs } = await supabase
      .from('whatsapp_messages')
      .select('from_me, text_body, message_type')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(5);

    const historyLines = (recentMsgs || []).reverse().map(m => {
      const sender = m.from_me ? 'Assistente' : 'Cliente';
      return `${sender}: ${m.text_body || `[${m.message_type}]`}`;
    });

    // 4. Build memories
    const memories = await getMemories(supabase, conversationId);
    const memoryContext = memories.length > 0
      ? '\nMEMORIAS DO CONTATO:\n' + memories.map(m => `  - ${m.key}: ${m.value}`).join('\n')
      : '';

    // 5. Build system prompt
    const systemPrompt = [
      config.system_prompt,
      `Seu nome: ${config.agent_name}`,
      'REGRAS:',
      '- Responda APENAS em texto simples',
      '- NUNCA colete dados de reserva pelo WhatsApp. Para reservas, SEMPRE direcione ao link: https://fullhouseagendamento.vercel.app',
      memoryContext,
    ].filter(Boolean).join('\n');

    const reservationContext = await buildReservationSystemPrompt(supabase, orgId);
    const fullSystemPrompt = reservationContext ? `${systemPrompt}\n\n${reservationContext}` : systemPrompt;

    // 6. Build messages array (WITH the fix: filter empty lines)
    const messages = [
      { role: 'system' as const, content: fullSystemPrompt },
      ...historyLines
        .filter(line => line.trim().length > 0)
        .map(line => {
          const isAssistant = line.startsWith('Assistente:');
          const content = line.replace(/^(Assistente|Cliente): /, '').trim();
          return {
            role: isAssistant ? ('assistant' as const) : ('user' as const),
            content: content || '...',
          };
        })
        .filter(m => m.content.length > 0),
      { role: 'user' as const, content: msg },
    ];

    // 7. Build model
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

    // 8. Build tools
    const reservationTools = await buildReservationTools(supabase, orgId, { phone: '5521996056963', name: 'Lucas' });
    const hasTools = Object.keys(reservationTools).length > 0;

    // 9. Call generateText
    const startTime = Date.now();
    let result;
    let usedTools = hasTools;

    try {
      result = await generateText({
        model: modelInstance,
        messages,
        maxOutputTokens: 500,
        ...(hasTools ? { maxSteps: 5, tools: reservationTools } : {}),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    } catch (toolErr) {
      usedTools = false;
      // Retry without tools
      result = await generateText({
        model: modelInstance,
        messages,
        maxOutputTokens: 500,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    }

    const elapsed = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      provider,
      model,
      usedTools,
      elapsed_ms: elapsed,
      text: result.text || '(empty)',
      text_length: result.text?.length ?? 0,
      steps: (result as any).steps?.length ?? 0,
      toolCalls: (result as any).toolCalls?.length ?? 0,
      messages_count: messages.length,
      input_msg: msg,
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack?.slice(0, 500) : undefined,
    }, { status: 500 });
  }
}
