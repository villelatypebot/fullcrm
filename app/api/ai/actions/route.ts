// Route Handler for AI "actions" (RPC-style helpers)
//
// This is the supported non-streaming endpoint for UI features that need a single, direct
// AI result (e.g. email draft, board generation, daily briefing).
//
// IMPORTANT:
// - Auth is cookie-based (Supabase SSR).
// - API keys are read server-side from `organization_settings`.
// - This is NOT the streaming Agent chat endpoint; that one is `/api/ai/chat`.
//
// Contract:
// POST { action: string, data: object }
// -> 200 { result?: any, error?: string, consentType?: string, retryAfter?: number }

import { generateObject, generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export const maxDuration = 60;

type AIActionResponse<T = unknown> = {
  result?: T;
  error?: string;
  consentType?: string;
  retryAfter?: number;
};

type AIAction =
  | 'analyzeLead'
  | 'generateEmailDraft'
  | 'generateObjectionResponse'
  | 'generateDailyBriefing'
  | 'generateRescueMessage'
  | 'parseNaturalLanguageAction'
  | 'chatWithCRM'
  | 'generateBirthdayMessage'
  | 'generateBoardStructure'
  | 'generateBoardStrategy'
  | 'refineBoardWithAI'
  | 'chatWithBoardAgent'
  | 'generateSalesScript';

const AnalyzeLeadSchema = z.object({
  action: z.string().max(50).describe('Ação curta e direta, máximo 50 caracteres.'),
  reason: z.string().max(80).describe('Razão breve, máximo 80 caracteres.'),
  actionType: z.enum(['CALL', 'MEETING', 'EMAIL', 'TASK', 'WHATSAPP']).describe('Tipo de ação sugerida'),
  urgency: z.enum(['low', 'medium', 'high']).describe('Urgência da ação'),
  probabilityScore: z.number().min(0).max(100).describe('Score de probabilidade (0-100)'),
});

const BoardStructureSchema = z.object({
  boardName: z.string().describe('Nome do board em português'),
  description: z.string().describe('Descrição do propósito do board'),
  stages: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      color: z.string().describe('Classe Tailwind CSS, ex: bg-blue-500'),
      linkedLifecycleStage: z.string().describe('ID do lifecycle stage: LEAD, MQL, PROSPECT, CUSTOMER ou OTHER'),
      estimatedDuration: z.string().optional(),
    })
  ),
  automationSuggestions: z.array(z.string()),
});

const BoardStrategySchema = z.object({
  goal: z.object({
    description: z.string(),
    kpi: z.string(),
    targetValue: z.string(),
  }),
  agentPersona: z.object({
    name: z.string(),
    role: z.string(),
    behavior: z.string(),
  }),
  entryTrigger: z.string(),
});

const RefineBoardSchema = z.object({
  message: z.string().describe('Resposta conversacional explicando mudanças'),
  board: BoardStructureSchema.nullable().describe('Board modificado ou null se apenas pergunta'),
});

const ObjectionResponseSchema = z.array(z.string()).describe('3 respostas diferentes para contornar objeção');

const ParsedActionSchema = z.object({
  title: z.string(),
  type: z.enum(['CALL', 'MEETING', 'EMAIL', 'TASK']),
  date: z.string().optional(),
  contactName: z.string().optional(),
  companyName: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

export async function POST(req: Request) {
  // Mitigação CSRF: bloqueia POST cross-site em endpoint que usa auth via cookies.
  if (!isAllowedOrigin(req)) {
    return json<AIActionResponse>({ error: 'Forbidden' }, 403);
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return json<AIActionResponse>({ error: 'Unauthorized' }, 401);
  }

  const body = await req.json().catch(() => null);
  const action = body?.action as AIAction | undefined;
  const data = (body?.data ?? {}) as Record<string, unknown>;

  if (!action) {
    return json<AIActionResponse>({ error: "Invalid request format. Missing 'action'." }, 400);
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (profileError || !profile?.organization_id) {
    return json<AIActionResponse>({ error: 'Profile not found' }, 404);
  }

  const { data: orgSettings, error: orgError } = await supabase
    .from('organization_settings')
    .select('ai_google_key, ai_model')
    .eq('organization_id', profile.organization_id)
    .single();

  // Frontend expects "AI consent required" as a *payload* error.
  if (orgError || !orgSettings?.ai_google_key) {
    return json<AIActionResponse>({ error: 'AI consent required', consentType: 'AI_CONSENT' }, 200);
  }

  const apiKey = orgSettings.ai_google_key;
  const modelId = orgSettings.ai_model || 'gemini-2.0-flash-exp';

  const google = createGoogleGenerativeAI({ apiKey });
  const model = google(modelId);

  try {
    switch (action) {
      case 'analyzeLead': {
        const { deal, stageLabel } = data as any;
        const result = await generateObject({
          model,
          maxRetries: 3,
          schema: AnalyzeLeadSchema,
          prompt: `Você é um coach de vendas analisando um deal de CRM. Seja DIRETO e ACIONÁVEL.
DEAL:
- Título: ${deal?.title}
- Valor: R$ ${deal?.value?.toLocaleString?.('pt-BR') ?? deal?.value ?? 0}
- Estágio: ${stageLabel || deal?.status}
- Probabilidade: ${deal?.probability || 50}%
RETORNE:
1. action: Verbo no infinitivo + complemento curto (máx 50 chars).
2. reason: Por que fazer isso AGORA (máx 80 chars).
3. actionType: CALL, MEETING, EMAIL, TASK ou WHATSAPP
4. urgency: low, medium, high
5. probabilityScore: 0-100
Seja conciso. Português do Brasil.`,
        });
        return json<AIActionResponse>({ result: result.object });
      }

      case 'generateEmailDraft': {
        const { deal } = data as any;
        const result = await generateText({
          model,
          maxRetries: 3,
          prompt: `Gere um rascunho de email profissional para:
- Contato: ${deal?.contactName || 'Cliente'}
- Empresa: ${deal?.companyName || 'Empresa'}
- Deal: ${deal?.title}
Escreva um email conciso e eficaz em português do Brasil.`,
        });
        return json<AIActionResponse>({ result: result.text });
      }

      case 'generateRescueMessage': {
        const { deal, channel } = data as any;
        const result = await generateText({
          model,
          maxRetries: 3,
          prompt: `Gere uma mensagem de resgate/follow-up para reativar um deal parado.
DEAL: ${deal?.title} (${deal?.contactName || ''})
CANAL: ${channel}
Responda em português do Brasil.`,
        });
        return json<AIActionResponse>({ result: result.text });
      }

      case 'generateBoardStructure': {
        const { description, lifecycleStages } = data as any;
        const lifecycleList =
          Array.isArray(lifecycleStages) && lifecycleStages.length > 0
            ? lifecycleStages.map((s: any) => ({ id: s?.id || '', name: s?.name || String(s) }))
            : [
                { id: 'LEAD', name: 'Lead' },
                { id: 'MQL', name: 'MQL' },
                { id: 'PROSPECT', name: 'Oportunidade' },
                { id: 'CUSTOMER', name: 'Cliente' },
                { id: 'OTHER', name: 'Outros' },
              ];

        const result = await generateObject({
          model,
          maxRetries: 3,
          schema: BoardStructureSchema,
          prompt: `Crie uma estrutura de board Kanban para: ${description}.
LIFECYCLES: ${JSON.stringify(lifecycleList)}
Crie 4-7 estágios com cores Tailwind. Português do Brasil.`,
        });

        return json<AIActionResponse>({ result: result.object });
      }

      case 'generateBoardStrategy': {
        const { boardData } = data as any;
        const result = await generateObject({
          model,
          maxRetries: 3,
          schema: BoardStrategySchema,
          prompt: `Defina estratégia para board: ${boardData?.boardName}.
Meta, KPI, Persona. Português do Brasil.`,
        });
        return json<AIActionResponse>({ result: result.object });
      }

      case 'refineBoardWithAI': {
        const { currentBoard, userInstruction, chatHistory } = data as any;
        const historyContext = chatHistory ? `\nHistórico:\n${JSON.stringify(chatHistory)}` : '';
        const boardContext = currentBoard
          ? `\nBoard atual (JSON):\n${JSON.stringify(currentBoard)}`
          : '';
        const result = await generateObject({
          model,
          maxRetries: 3,
          schema: RefineBoardSchema,
          prompt: `Ajuste o board com base na instrução: "${userInstruction}".
${boardContext}
${historyContext}
Se for conversa, retorne board: null.`,
        });
        return json<AIActionResponse>({ result: result.object });
      }

      case 'generateObjectionResponse': {
        const { deal, objection } = data as any;
        const result = await generateObject({
          model,
          maxRetries: 3,
          schema: ObjectionResponseSchema,
          prompt: `Objeção: "${objection}" no deal "${deal?.title}".
Gere 3 respostas práticas (Empática, Valor, Pergunta).`,
        });
        return json<AIActionResponse>({ result: result.object });
      }

      case 'parseNaturalLanguageAction': {
        const { text } = data as any;
        const result = await generateObject({
          model,
          maxRetries: 3,
          schema: ParsedActionSchema,
          prompt: `Parse para CRM Action: "${text}".
Campos: title, type (CALL/MEETING/EMAIL/TASK), date, contactName, companyName, confidence.`,
        });
        return json<AIActionResponse>({ result: result.object });
      }

      case 'chatWithCRM': {
        const { message, context } = data as any;
        const result = await generateText({
          model,
          maxRetries: 3,
          prompt: `Assistente CRM.
Contexto: ${JSON.stringify(context)}
Usuário: ${message}
Responda em português.`,
        });
        return json<AIActionResponse>({ result: result.text });
      }

      case 'generateBirthdayMessage': {
        const { contactName, age } = data as any;
        const result = await generateText({
          model,
          maxRetries: 3,
          prompt: `Parabéns para ${contactName} (${age || ''} anos). Curto e profissional.`,
        });
        return json<AIActionResponse>({ result: result.text });
      }

      case 'generateDailyBriefing': {
        const result = await generateText({
          model,
          maxRetries: 3,
          prompt: `Briefing diário. Dados: ${JSON.stringify(data)}. Resuma prioridades.`,
        });
        return json<AIActionResponse>({ result: result.text });
      }

      case 'chatWithBoardAgent': {
        const { message, boardContext } = data as any;
        const result = await generateText({
          model,
          maxRetries: 3,
          prompt: `Persona: ${boardContext?.agentName}. Contexto: ${JSON.stringify(boardContext)}. Msg: ${message}`,
        });
        return json<AIActionResponse>({ result: result.text });
      }

      case 'generateSalesScript': {
        const { deal, scriptType, context } = data as any;
        const result = await generateText({
          model,
          maxRetries: 3,
          prompt: `Gere script de vendas (${scriptType}).
Deal: ${deal?.title}. Contexto: ${context || ''}.
Seja natural, 4 parágrafos max.`,
        });
        return json<AIActionResponse>({ result: { script: result.text, scriptType, generatedFor: deal?.title } });
      }

      default: {
        const exhaustive: never = action;
        return json<AIActionResponse>({ error: `Unknown action: ${exhaustive}` }, 200);
      }
    }
  } catch (err: any) {
    console.error('[api/ai/actions] Error:', err);
    return json<AIActionResponse>({ error: err?.message || 'Internal Server Error' }, 200);
  }
}
