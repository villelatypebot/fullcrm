import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Fetch all intelligence data in parallel
  const [memories, leadScore, labels, followUps, summary] = await Promise.all([
    getMemories(supabase, id),
    getLeadScore(supabase, id),
    getConversationLabels(supabase, id),
    getFollowUps(supabase, id),
    getLatestSummary(supabase, id),
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
