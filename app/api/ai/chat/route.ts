// Route Handler for AI Chat - /api/ai/chat
// Full integration with AI SDK v6 ToolLoopAgent + createAgentUIStreamResponse

import { createAgentUIStreamResponse, UIMessage } from 'ai';
import { createCRMAgent } from '@/lib/ai/crmAgent';
import { createClient } from '@/lib/supabase/server';
import type { CRMCallOptions } from '@/types/ai';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export const maxDuration = 60;

export async function POST(req: Request) {
    // Mitigação CSRF: endpoint autenticado por cookies.
    if (!isAllowedOrigin(req)) {
        return new Response('Forbidden', { status: 403 });
    }

    const supabase = await createClient();

    // 1. Auth check
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        return new Response('Unauthorized', { status: 401 });
    }

    // 2. Get profile with organization + role (RBAC)
    const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id, first_name, nickname, role')
        .eq('id', user.id)
        .single();

    if (!profile?.organization_id) {
        return new Response('Profile not found', { status: 404 });
    }

    const organizationId = profile.organization_id;

    // 3. Get API key (org-wide: organization_settings é a fonte de verdade)
    const { data: orgSettings } = await supabase
        .from('organization_settings')
        .select('ai_google_key, ai_model')
        .eq('organization_id', organizationId)
        .maybeSingle();

    const apiKey: string | null = orgSettings?.ai_google_key ?? null;
    const modelId: string | null = orgSettings?.ai_model ?? null;

    if (!apiKey) {
        return new Response('API key not configured. Configure em Configurações → Inteligência Artificial.', { status: 400 });
    }

    const resolvedModelId = modelId || 'gemini-2.5-flash';

    // 4. Parse request with context
    const body = await req.json();
    const messages: UIMessage[] = body.messages;
    const rawContext = body.context || {};

    // 5. Build type-safe context for agent
    const context: CRMCallOptions = {
        organizationId,
        boardId: rawContext.boardId,
        dealId: rawContext.dealId,
        contactId: rawContext.contactId,
        boardName: rawContext.boardName,
        stages: rawContext.stages,
        dealCount: rawContext.dealCount,
        pipelineValue: rawContext.pipelineValue,
        stagnantDeals: rawContext.stagnantDeals,
        overdueDeals: rawContext.overdueDeals,
        wonStage: rawContext.wonStage,
        lostStage: rawContext.lostStage,
        userId: user.id,
        userName: profile.nickname || profile.first_name || user.email,
        userRole: (profile as any)?.role,
    };

    console.log('[AI Chat] 📨 Request received:', {
        messagesCount: messages?.length,
        rawContext,
        context: {
            organizationId: context.organizationId,
            boardId: context.boardId,
            dealId: context.dealId,
            boardName: context.boardName,
            stagesCount: context.stages?.length,
            userName: context.userName,
        },
    });

    // 6. Create agent with API key and context
    const agent = await createCRMAgent(context, user.id, apiKey, resolvedModelId);

    // 7. Return streaming response using AI SDK v6 createAgentUIStreamResponse
    return createAgentUIStreamResponse({
        agent,
        messages,
        options: context,
    });
}
