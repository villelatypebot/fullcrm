import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getConversation, updateConversation, insertAILog } from '@/lib/supabase/whatsapp';

type Params = { params: Promise<{ id: string }> };

const AIControlSchema = z.object({
  action: z.enum(['pause', 'resume']),
  reason: z.string().optional(),
});

/** Control AI agent for a conversation (pause/resume) */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();
  const userId = user?.id || '00000000-0000-0000-0000-000000000000';

  const conversation = await getConversation(queryClient, id);
  if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });

  const body = await request.json().catch(() => null);
  const parsed = AIControlSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const { action, reason } = parsed.data;

  if (action === 'pause') {
    await updateConversation(queryClient, id, {
      ai_active: false,
      ai_paused_by: userId,
      ai_paused_at: new Date().toISOString(),
      ai_pause_reason: reason ?? 'panel_stop',
    } as Parameters<typeof updateConversation>[2]);

    await insertAILog(queryClient, {
      conversation_id: id,
      organization_id: conversation.organization_id,
      action: 'paused',
      details: { reason: reason ?? 'panel_stop', paused_by: userId },
      triggered_by: `user:${userId}`,
    });
  } else {
    await updateConversation(queryClient, id, {
      ai_active: true,
      ai_paused_by: undefined,
      ai_paused_at: undefined,
      ai_pause_reason: undefined,
    } as Parameters<typeof updateConversation>[2]);

    await insertAILog(queryClient, {
      conversation_id: id,
      organization_id: conversation.organization_id,
      action: 'resumed',
      details: { resumed_by: userId },
      triggered_by: `user:${userId}`,
    });
  }

  return NextResponse.json({ ok: true, ai_active: action === 'resume' });
}
