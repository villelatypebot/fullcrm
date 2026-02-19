/**
 * Supabase service layer for WhatsApp Intelligence features:
 * - Chat Memory
 * - Follow-ups
 * - Labels
 * - Lead Scores
 * - Conversation Summaries
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ChatMemory,
  WhatsAppFollowUp,
  WhatsAppLabel,
  ConversationLabel,
  LeadScore,
  ConversationSummary,
  FollowUpStatus,
  ExtractedMemory,
  CustomerSentiment,
  BuyingStage,
} from '@/types/whatsapp';

// =============================================================================
// CHAT MEMORY
// =============================================================================

export async function getMemories(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ChatMemory[]> {
  const { data, error } = await supabase
    .from('whatsapp_chat_memory')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function getMemoriesByContact(
  supabase: SupabaseClient,
  contactId: string,
): Promise<ChatMemory[]> {
  const { data, error } = await supabase
    .from('whatsapp_chat_memory')
    .select('*')
    .eq('contact_id', contactId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function upsertMemory(
  supabase: SupabaseClient,
  memory: {
    conversation_id: string;
    organization_id: string;
    contact_id?: string;
    memory_type: string;
    key: string;
    value: string;
    context?: string;
    source_message_id?: string;
    confidence?: number;
  },
): Promise<ChatMemory> {
  // Check if memory with same key already exists for this conversation
  const { data: existing } = await supabase
    .from('whatsapp_chat_memory')
    .select('id')
    .eq('conversation_id', memory.conversation_id)
    .eq('key', memory.key)
    .maybeSingle();

  if (existing) {
    // Update existing memory
    const { data, error } = await supabase
      .from('whatsapp_chat_memory')
      .update({
        value: memory.value,
        context: memory.context,
        confidence: memory.confidence ?? 0.8,
        source_message_id: memory.source_message_id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  // Insert new memory
  const { data, error } = await supabase
    .from('whatsapp_chat_memory')
    .insert({
      ...memory,
      confidence: memory.confidence ?? 0.8,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function saveExtractedMemories(
  supabase: SupabaseClient,
  conversationId: string,
  organizationId: string,
  contactId: string | undefined,
  memories: ExtractedMemory[],
  sourceMessageId?: string,
): Promise<ChatMemory[]> {
  const saved: ChatMemory[] = [];
  for (const mem of memories) {
    const result = await upsertMemory(supabase, {
      conversation_id: conversationId,
      organization_id: organizationId,
      contact_id: contactId,
      memory_type: mem.memory_type,
      key: mem.key,
      value: mem.value,
      context: mem.context,
      source_message_id: sourceMessageId,
      confidence: mem.confidence,
    });
    saved.push(result);
  }
  return saved;
}

export async function deleteMemory(
  supabase: SupabaseClient,
  memoryId: string,
): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_chat_memory')
    .delete()
    .eq('id', memoryId);
  if (error) throw error;
}

// =============================================================================
// FOLLOW-UPS
// =============================================================================

export async function getFollowUps(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<WhatsAppFollowUp[]> {
  const { data, error } = await supabase
    .from('whatsapp_follow_ups')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('trigger_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function getPendingFollowUps(
  supabase: SupabaseClient,
  organizationId?: string,
): Promise<WhatsAppFollowUp[]> {
  let query = supabase
    .from('whatsapp_follow_ups')
    .select('*')
    .eq('status', 'pending')
    .lte('trigger_at', new Date().toISOString())
    .order('trigger_at', { ascending: true })
    .limit(50);

  if (organizationId) {
    query = query.eq('organization_id', organizationId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createFollowUp(
  supabase: SupabaseClient,
  followUp: {
    conversation_id: string;
    organization_id: string;
    instance_id: string;
    trigger_at: string;
    follow_up_type?: string;
    detected_intent?: string;
    intent_confidence?: number;
    context?: Record<string, unknown>;
    original_customer_message?: string;
    ai_generated_message?: string;
    custom_instructions?: string;
    original_message_id?: string;
    created_by?: string;
  },
): Promise<WhatsAppFollowUp> {
  const { data, error } = await supabase
    .from('whatsapp_follow_ups')
    .insert({
      ...followUp,
      follow_up_type: followUp.follow_up_type ?? 'smart',
      context: followUp.context ?? {},
      created_by: followUp.created_by ?? 'ai',
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateFollowUpStatus(
  supabase: SupabaseClient,
  followUpId: string,
  status: FollowUpStatus,
  sentMessageId?: string,
): Promise<void> {
  const updates: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (sentMessageId) updates.sent_message_id = sentMessageId;
  if (status === 'sent') updates.sent_at = new Date().toISOString();

  const { error } = await supabase
    .from('whatsapp_follow_ups')
    .update(updates)
    .eq('id', followUpId);

  if (error) throw error;
}

export async function cancelPendingFollowUps(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('whatsapp_follow_ups')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .eq('status', 'pending')
    .select('id');

  if (error) throw error;
  return data?.length ?? 0;
}

export async function countActiveFollowUps(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<number> {
  const { count, error } = await supabase
    .from('whatsapp_follow_ups')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .in('status', ['pending', 'sent']);

  if (error) throw error;
  return count ?? 0;
}

// =============================================================================
// LABELS
// =============================================================================

export async function getLabels(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<WhatsAppLabel[]> {
  const { data, error } = await supabase
    .from('whatsapp_labels')
    .select('*')
    .eq('organization_id', organizationId)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function ensureDefaultLabels(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<void> {
  // Check if labels already exist
  const { count } = await supabase
    .from('whatsapp_labels')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId);

  if (count && count > 0) return;

  // Call the SQL function to create defaults
  await supabase.rpc('create_default_whatsapp_labels', { org_id: organizationId });
}

export async function createLabel(
  supabase: SupabaseClient,
  label: {
    organization_id: string;
    name: string;
    color?: string;
    icon?: string;
    description?: string;
  },
): Promise<WhatsAppLabel> {
  const { data, error } = await supabase
    .from('whatsapp_labels')
    .insert(label)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteLabel(
  supabase: SupabaseClient,
  labelId: string,
): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_labels')
    .delete()
    .eq('id', labelId)
    .eq('is_system', false); // Can't delete system labels
  if (error) throw error;
}

export async function getConversationLabels(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ConversationLabel[]> {
  const { data, error } = await supabase
    .from('whatsapp_conversation_labels')
    .select('*, label:whatsapp_labels(*)')
    .eq('conversation_id', conversationId);

  if (error) throw error;
  return data ?? [];
}

export async function assignLabel(
  supabase: SupabaseClient,
  conversationId: string,
  labelId: string,
  organizationId: string,
  assignedBy = 'ai',
  reason?: string,
): Promise<ConversationLabel> {
  const { data, error } = await supabase
    .from('whatsapp_conversation_labels')
    .upsert(
      {
        conversation_id: conversationId,
        label_id: labelId,
        organization_id: organizationId,
        assigned_by: assignedBy,
        reason,
      },
      { onConflict: 'conversation_id,label_id' },
    )
    .select('*, label:whatsapp_labels(*)')
    .single();

  if (error) throw error;
  return data;
}

export async function removeLabel(
  supabase: SupabaseClient,
  conversationId: string,
  labelId: string,
): Promise<void> {
  const { error } = await supabase
    .from('whatsapp_conversation_labels')
    .delete()
    .eq('conversation_id', conversationId)
    .eq('label_id', labelId);
  if (error) throw error;
}

export async function assignLabelByName(
  supabase: SupabaseClient,
  conversationId: string,
  organizationId: string,
  labelName: string,
  assignedBy = 'ai',
  reason?: string,
): Promise<ConversationLabel | null> {
  // Find label by name
  const { data: label } = await supabase
    .from('whatsapp_labels')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('name', labelName)
    .maybeSingle();

  if (!label) return null;

  return assignLabel(supabase, conversationId, label.id, organizationId, assignedBy, reason);
}

// =============================================================================
// LEAD SCORES
// =============================================================================

export async function getLeadScore(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<LeadScore | null> {
  const { data, error } = await supabase
    .from('whatsapp_lead_scores')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function upsertLeadScore(
  supabase: SupabaseClient,
  conversationId: string,
  organizationId: string,
  contactId: string | undefined,
  scoreDelta: number,
  factors?: Record<string, number>,
  buyingStage?: BuyingStage,
): Promise<LeadScore> {
  // Get current score
  const existing = await getLeadScore(supabase, conversationId);
  const currentScore = existing?.score ?? 0;
  const newScore = Math.max(0, Math.min(100, currentScore + scoreDelta));

  // Determine temperature
  let temperature: string;
  if (newScore >= 80) temperature = 'on_fire';
  else if (newScore >= 60) temperature = 'hot';
  else if (newScore >= 30) temperature = 'warm';
  else temperature = 'cold';

  // Merge factors
  const mergedFactors = { ...(existing?.factors ?? {}), ...(factors ?? {}) };

  // Build history entry
  const historyEntry = {
    score: newScore,
    timestamp: new Date().toISOString(),
    reason: `Delta: ${scoreDelta > 0 ? '+' : ''}${scoreDelta}`,
  };

  const scoreHistory = [...(existing?.score_history ?? []), historyEntry].slice(-50); // Keep last 50

  const { data, error } = await supabase
    .from('whatsapp_lead_scores')
    .upsert(
      {
        conversation_id: conversationId,
        organization_id: organizationId,
        contact_id: contactId,
        score: newScore,
        temperature,
        factors: mergedFactors,
        buying_stage: buyingStage ?? existing?.buying_stage ?? 'awareness',
        score_history: scoreHistory,
        last_calculated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'conversation_id' },
    )
    .select()
    .single();

  if (error) throw error;
  return data;
}

// =============================================================================
// CONVERSATION SUMMARIES
// =============================================================================

export async function getLatestSummary(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ConversationSummary | null> {
  const { data, error } = await supabase
    .from('whatsapp_conversation_summaries')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function getSummaries(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 10,
): Promise<ConversationSummary[]> {
  const { data, error } = await supabase
    .from('whatsapp_conversation_summaries')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function insertSummary(
  supabase: SupabaseClient,
  summary: {
    conversation_id: string;
    organization_id: string;
    summary: string;
    key_points?: string[];
    next_actions?: string[];
    customer_sentiment?: CustomerSentiment;
    trigger_reason?: string;
    message_range_start?: string;
    message_range_end?: string;
  },
): Promise<ConversationSummary> {
  const { data, error } = await supabase
    .from('whatsapp_conversation_summaries')
    .insert({
      ...summary,
      key_points: summary.key_points ?? [],
      next_actions: summary.next_actions ?? [],
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
