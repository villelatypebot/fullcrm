import { generateObject, generateText, LanguageModel } from "ai";
import { z } from "zod";
import { executeWithFallback, ProviderConfig } from "./config.ts";
import {
    executeCreateActivity,
    executeSendWhatsApp,
    executeMoveDeal,
    executeSearchDeals
} from "./tools.ts";

/**
 * AI Action Types
 */
export type AIAction =
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
    | 'generateSalesScript'
    // Tool Actions
    | 'createActivity'
    | 'sendWhatsApp'
    | 'moveDeal'
    | 'searchDeals';

// ============================================================================
// SCHEMAS
// ============================================================================

const AnalyzeLeadSchema = z.object({
    action: z.string().max(50).describe('Ação curta e direta, máximo 50 caracteres. Ex: Agendar reunião de follow-up'),
    reason: z.string().max(80).describe('Razão breve, máximo 80 caracteres. Ex: Cliente ativo há 3 dias sem contato'),
    actionType: z.enum(['CALL', 'MEETING', 'EMAIL', 'TASK', 'WHATSAPP']).describe('Tipo de ação sugerida'),
    urgency: z.enum(['low', 'medium', 'high']).describe('Urgência da ação'),
    probabilityScore: z.number().min(0).max(100).describe('Score de probabilidade de fechamento (0-100)'),
});

const BoardStructureSchema = z.object({
    boardName: z.string().describe('Nome do board em português'),
    description: z.string().describe('Descrição do propósito do board'),
    stages: z.array(z.object({
        name: z.string(),
        description: z.string(),
        color: z.string().describe('Classe Tailwind CSS, ex: bg-blue-500'),
        linkedLifecycleStage: z.string().describe('ID do lifecycle stage: LEAD, MQL, PROSPECT, CUSTOMER ou OTHER'),
        estimatedDuration: z.string().optional(),
    })),
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

// ============================================================================
// HANDLERS
// ============================================================================

async function analyzeLead(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { deal, stageLabel } = data as { deal: any; stageLabel?: string };
    return executeWithFallback(providers, async (model) => {
        const result = await generateObject({
            model,
            maxRetries: 3,
            schema: AnalyzeLeadSchema,
            prompt: `Você é um coach de vendas analisando um deal de CRM. Seja DIRETO e ACIONÁVEL.
DEAL:
- Título: ${deal.title}
- Valor: R$ ${deal.value?.toLocaleString('pt-BR') || 0}
- Estágio: ${stageLabel || deal.status}
- Probabilidade: ${deal.probability || 50}%
RETORNE:
1. action: Verbo no infinitivo + complemento curto (máx 50 chars). 
2. reason: Por que fazer isso AGORA (máx 80 chars).
3. actionType: CALL, MEETING, EMAIL, TASK ou WHATSAPP
4. urgency: low, medium, high
5. probabilityScore: 0-100
Seja conciso. Português do Brasil.`,
        });
        return result.object;
    });
}

async function generateEmailDraft(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { deal, stageLabel } = data as { deal: any; stageLabel?: string };
    return executeWithFallback(providers, async (model) => {
        const result = await generateText({
            model,
            maxRetries: 3,
            prompt: `Gere um rascunho de email profissional para:
- Contato: ${deal.contactName || 'Cliente'}
- Empresa: ${deal.companyName || 'Empresa'}
- Deal: ${deal.title}
Escreva um email conciso e eficaz em português do Brasil.`,
        });
        return result.text;
    });
}

async function generateRescueMessage(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { deal, channel, stageLabel } = data as { deal: any; channel: string; stageLabel?: string };
    return executeWithFallback(providers, async (model) => {
        const result = await generateText({
            model,
            maxRetries: 3,
            prompt: `Gere uma mensagem de resgate/follow-up para reativar um deal parado.
DEAL: ${deal.title} (${deal.contactName})
CANAL: ${channel}
Responda em português do Brasil.`,
        });
        return result.text;
    });
}

async function generateBoardStructure(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { description, lifecycleStages } = data as { description: string; lifecycleStages?: any[] };
    const lifecycleList = Array.isArray(lifecycleStages) && lifecycleStages.length > 0
        ? lifecycleStages.map((s: any) => ({ id: s.id || '', name: s.name || s }))
        : [{ id: 'LEAD', name: 'Lead' }, { id: 'MQL', name: 'MQL' }, { id: 'PROSPECT', name: 'Oportunidade' }, { id: 'CUSTOMER', name: 'Cliente' }, { id: 'OTHER', name: 'Outros' }];

    return executeWithFallback(providers, async (model) => {
        const result = await generateObject({
            model,
            maxRetries: 3,
            schema: BoardStructureSchema,
            prompt: `Crie uma estrutura de board Kanban para: ${description}.
LIFECYCLES: ${JSON.stringify(lifecycleList)}
Crie 4-7 estágios com cores Tailwind. Português do Brasil.`,
        });
        return result.object;
    });
}

async function generateBoardStrategy(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { boardData } = data as any;
    return executeWithFallback(providers, async (model) => {
        const result = await generateObject({
            model,
            maxRetries: 3,
            schema: BoardStrategySchema,
            prompt: `Defina estratégia para board: ${boardData.boardName}.
Meta, KPI, Persona. Português do Brasil.`,
        });
        return result.object;
    });
}

async function refineBoardWithAI(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { currentBoard, userInstruction, chatHistory } = data as any;
    const historyContext = chatHistory ? `\nHistórico:\n${JSON.stringify(chatHistory)}` : '';
    return executeWithFallback(providers, async (model) => {
        const result = await generateObject({
            model,
            maxRetries: 3,
            schema: RefineBoardSchema,
            prompt: `Ajuste o board com base na instrução: "${userInstruction}".
${historyContext}
Se for conversa, retorne board: null.`,
        });
        return result.object;
    });
}

async function generateObjectionResponse(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { deal, objection } = data as any;
    return executeWithFallback(providers, async (model) => {
        const result = await generateObject({
            model,
            maxRetries: 3,
            schema: ObjectionResponseSchema,
            prompt: `Objeção: "${objection}" no deal "${deal.title}".
Gere 3 respostas práticas (Empática, Valor, Pergunta).`,
        });
        return result.object;
    });
}

async function parseNaturalLanguageAction(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { text } = data as any;
    return executeWithFallback(providers, async (model) => {
        const result = await generateObject({
            model,
            maxRetries: 3,
            schema: ParsedActionSchema,
            prompt: `Parse para CRM Action: "${text}".
Campos: title, type (CALL/MEETING/EMAIL/TASK), date, contactName, companyName, confidence.`,
        });
        return result.object;
    });
}

async function chatWithCRM(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { message, context } = data as any;
    return executeWithFallback(providers, async (model) => {
        const result = await generateText({
            model,
            maxRetries: 3,
            prompt: `Assistente CRM.
Contexto: ${JSON.stringify(context)}
Usuário: ${message}
Responda em português.`,
        });
        return result.text;
    });
}

async function generateBirthdayMessage(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { contactName, age } = data as any;
    return executeWithFallback(providers, async (model) => {
        return (await generateText({
            model,
            maxRetries: 3,
            prompt: `Parabéns para ${contactName} (${age || ''} anos). Curto e profissional.`,
        })).text;
    });
}

async function generateDailyBriefing(providers: ProviderConfig[], data: Record<string, unknown>) {
    const briefingData = data as any;
    return executeWithFallback(providers, async (model) => {
        return (await generateText({
            model,
            maxRetries: 3,
            prompt: `Briefing diário. Dados: ${JSON.stringify(briefingData)}. Resuma prioridades.`,
        })).text;
    });
}

async function chatWithBoardAgent(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { message, boardContext } = data as any;
    return executeWithFallback(providers, async (model) => {
        return (await generateText({
            model,
            maxRetries: 3,
            prompt: `Persona: ${boardContext.agentName}. Contexto: ${JSON.stringify(boardContext)}. Msg: ${message}`,
        })).text;
    });
}

async function generateSalesScript(providers: ProviderConfig[], data: Record<string, unknown>) {
    const { deal, scriptType, context } = data as any;
    const result = await executeWithFallback(providers, async (model) => {
        return await generateText({
            model,
            maxRetries: 3,
            prompt: `Gere script de vendas (${scriptType}).
Deal: ${deal.title}. Contexto: ${context || ''}.
Seja natural, 4 parágrafos max.`,
        });
    });
    return { script: result.text, scriptType, generatedFor: deal.title };
}

// Router for Legacy Actions
export async function processLegacyRequest(
    providers: ProviderConfig[],
    action: AIAction,
    data: Record<string, unknown>,
    userId: string
): Promise<unknown> {
    switch (action) {
        case 'analyzeLead': return analyzeLead(providers, data);
        case 'generateEmailDraft': return generateEmailDraft(providers, data);
        case 'generateRescueMessage': return generateRescueMessage(providers, data);
        case 'generateBoardStructure': return generateBoardStructure(providers, data);
        case 'generateBoardStrategy': return generateBoardStrategy(providers, data);
        case 'refineBoardWithAI': return refineBoardWithAI(providers, data);
        case 'generateObjectionResponse': return generateObjectionResponse(providers, data);
        case 'parseNaturalLanguageAction': return parseNaturalLanguageAction(providers, data);
        case 'chatWithCRM': return chatWithCRM(providers, data);
        case 'generateBirthdayMessage': return generateBirthdayMessage(providers, data);
        case 'generateDailyBriefing': return generateDailyBriefing(providers, data);
        case 'chatWithBoardAgent': return chatWithBoardAgent(providers, data);
        case 'generateSalesScript': return generateSalesScript(providers, data);

        // Initial Tool Integrations (Legacy way)
        case 'createActivity': return executeCreateActivity(userId, data as any);
        case 'sendWhatsApp': return executeSendWhatsApp(userId, data as any);
        case 'moveDeal': return executeMoveDeal(userId, data as any);
        case 'searchDeals': return executeSearchDeals(userId, data as any);

        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
