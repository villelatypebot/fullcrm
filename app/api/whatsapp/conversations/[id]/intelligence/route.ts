import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import {
  getMemories,
  getLeadScore,
  getConversationLabels,
  getFollowUps,
  getLatestSummary,
} from '@/lib/supabase/whatsappIntelligence';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/whatsapp/conversations/[id]/intelligence
 *
 * Returns ALL intelligence data for a conversation in one call:
 * - Memories
 * - Lead score
 * - Labels
 * - Follow-ups
 * - Latest summary
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();

  // Fetch all intelligence data in parallel
  const [memories, leadScore, labels, followUps, summary] = await Promise.all([
    getMemories(queryClient, id),
    getLeadScore(queryClient, id),
    getConversationLabels(queryClient, id),
    getFollowUps(queryClient, id),
    getLatestSummary(queryClient, id),
  ]);

  return NextResponse.json({
    data: {
      memories,
      leadScore,
      labels,
      followUps,
      summary,
    },
  });
}
