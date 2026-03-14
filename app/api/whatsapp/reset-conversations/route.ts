import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/server';

/**
 * POST /api/whatsapp/reset-conversations
 * Delete all conversations and messages to force a clean re-sync
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminSupabase = createStaticAdminClient();

  // Get user's organization
  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });

  // Delete all messages first (FK constraint)
  const { error: msgErr, count: msgCount } = await adminSupabase
    .from('whatsapp_messages')
    .delete({ count: 'exact' })
    .eq('organization_id', profile.organization_id);

  // Delete all conversations
  const { error: convErr, count: convCount } = await adminSupabase
    .from('whatsapp_conversations')
    .delete({ count: 'exact' })
    .eq('organization_id', profile.organization_id);

  return NextResponse.json({
    success: true,
    deletedMessages: msgCount ?? 0,
    deletedConversations: convCount ?? 0,
    errors: {
      messages: msgErr?.message,
      conversations: convErr?.message,
    },
  });
}
