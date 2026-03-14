import { NextResponse } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/contacts/sync-temperatures
 *
 * Bulk syncs lead temperatures from whatsapp_lead_scores to contacts table.
 * Useful for retroactive sync when contacts were created before lead scoring.
 */
export async function POST() {
  const supabase = createStaticAdminClient();

  // Get all lead scores that have a contact_id
  const { data: scores, error } = await supabase
    .from('whatsapp_lead_scores')
    .select('contact_id, temperature, score, buying_stage')
    .not('contact_id', 'is', null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let synced = 0;
  for (const score of scores ?? []) {
    if (!score.contact_id) continue;
    const { error: updateErr } = await supabase
      .from('contacts')
      .update({
        temperature: score.temperature,
        lead_score: score.score,
        buying_stage: score.buying_stage,
      })
      .eq('id', score.contact_id);

    if (!updateErr) synced++;
  }

  // Also try to link unlinked conversations
  const { data: unlinked } = await supabase
    .from('whatsapp_lead_scores')
    .select('id, conversation_id, temperature, score, buying_stage')
    .is('contact_id', null);

  let linked = 0;
  for (const score of unlinked ?? []) {
    // Get conversation's contact_id
    const { data: conv } = await supabase
      .from('whatsapp_conversations')
      .select('contact_id')
      .eq('id', score.conversation_id)
      .single();

    if (conv?.contact_id) {
      // Update lead score with contact_id
      await supabase
        .from('whatsapp_lead_scores')
        .update({ contact_id: conv.contact_id })
        .eq('id', score.id);

      // Sync to contact
      await supabase
        .from('contacts')
        .update({
          temperature: score.temperature,
          lead_score: score.score,
          buying_stage: score.buying_stage,
        })
        .eq('id', conv.contact_id);

      linked++;
    }
  }

  return NextResponse.json({ ok: true, synced, linked });
}
