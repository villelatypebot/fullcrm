import { NextResponse, type NextRequest } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getMessages, getConversation, markConversationRead } from '@/lib/supabase/whatsapp';

type Params = { params: Promise<{ id: string }> };

/** Get messages for a conversation */
export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();

  const conversation = await getConversation(queryClient, id);
  if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const searchParams = request.nextUrl.searchParams;
  const messages = await getMessages(queryClient, id, {
    limit: Number(searchParams.get('limit')) || 100,
    before: searchParams.get('before') ?? undefined,
  });

  // Mark as read
  if (conversation.unread_count > 0) {
    await markConversationRead(queryClient, id);
  }

  return NextResponse.json({ data: messages });
}
