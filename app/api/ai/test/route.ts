// Test route for AI tools - bypasses auth for development testing
// DELETE THIS FILE BEFORE PRODUCTION!

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { CRMCallOptions } from '@/types/ai';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

export const maxDuration = 60;

// Test configuration - uses service role
const isTestRouteEnabled =
    process.env.NODE_ENV === 'development' &&
    String(process.env.ALLOW_AI_TEST_ROUTE).toLowerCase() === 'true';

export async function POST(req: Request) {
    // Dev-only guard: this endpoint uses the Supabase Service Role key.
    // Deny by default in all environments.
    if (!isTestRouteEnabled) {
        return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }

    // Mitigação CSRF / hardening (mesmo em dev): só aceita same-origin quando Origin existir.
    if (!isAllowedOrigin(req)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
        return NextResponse.json(
            { error: 'Missing Supabase env vars for test route' },
            { status: 500 }
        );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body = await req.json().catch(() => null);

    if (!body || typeof body !== 'object') {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const organizationId: unknown = body.organizationId;
    if (typeof organizationId !== 'string' || !organizationId) {
        return NextResponse.json({ error: 'Missing organizationId (dev test route requires it)' }, { status: 400 });
    }

    const rawContext: Record<string, unknown> = (body.context && typeof body.context === 'object') ? body.context : {};
    const context: CRMCallOptions = {
        organizationId,
        boardId: typeof rawContext.boardId === 'string' ? rawContext.boardId : undefined,
        dealId: typeof rawContext.dealId === 'string' ? rawContext.dealId : undefined,
        contactId: typeof rawContext.contactId === 'string' ? rawContext.contactId : undefined,
        boardName: typeof rawContext.boardName === 'string' ? rawContext.boardName : undefined,
        stages: Array.isArray(rawContext.stages)
            ? (rawContext.stages as unknown as Array<{ id: string; name: string }>)
            : undefined,
        dealCount: typeof rawContext.dealCount === 'number' ? rawContext.dealCount : undefined,
        pipelineValue: typeof rawContext.pipelineValue === 'number' ? rawContext.pipelineValue : undefined,
        stagnantDeals: typeof rawContext.stagnantDeals === 'number' ? rawContext.stagnantDeals : undefined,
        overdueDeals: typeof rawContext.overdueDeals === 'number' ? rawContext.overdueDeals : undefined,
        wonStage: typeof rawContext.wonStage === 'string' ? rawContext.wonStage : undefined,
        lostStage: typeof rawContext.lostStage === 'string' ? rawContext.lostStage : undefined,
        userId: typeof rawContext.userId === 'string' ? rawContext.userId : undefined,
        userName: typeof rawContext.userName === 'string' ? rawContext.userName : undefined,
    };
    const toolName = body.tool || 'listDealsByStage';
    const toolArgs = body.args || {};

    // Avoid logging sensitive org context in dev by default.

    // Simulate what the tools do
    const targetBoardId = toolArgs.boardId || context.boardId;
    const stageName = toolArgs.stageName || 'Proposta';

    if (!targetBoardId) {
        return NextResponse.json({ error: 'No boardId provided in context or args' });
    }

    // Test: Find stage
    const { data: stages, error: stageError } = await supabase
        .from('board_stages')
        .select('id, name, label')
        .eq('organization_id', context.organizationId)
        .eq('board_id', targetBoardId)
        .or(`name.ilike.%${stageName}%,label.ilike.%${stageName}%`);

    if (!stages || stages.length === 0) {
        return NextResponse.json({
            error: `Stage "${stageName}" not found`,
            boardId: targetBoardId
        });
    }

    const stageId = stages[0].id;

    // Test: Find deals
    const { data: deals, error: dealsError } = await supabase
        .from('deals')
        .select('id, title, value')
        .eq('organization_id', context.organizationId)
        .eq('board_id', targetBoardId)
        .eq('stage_id', stageId)
        .eq('is_won', false)
        .eq('is_lost', false)
        .order('value', { ascending: false })
        .limit(10);

    return NextResponse.json({
        success: true,
        tool: toolName,
        context: { boardId: targetBoardId, stageName },
        stage: stages[0],
        dealsCount: deals?.length || 0,
        deals: deals || []
    });
}
