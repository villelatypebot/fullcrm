import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getMemories, deleteMemory } from '@/lib/supabase/whatsappIntelligence';

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/whatsapp/conversations/[id]/memory - Get all memories for a conversation
 * DELETE /api/whatsapp/conversations/[id]/memory?memoryId=xxx - Delete a memory
 */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();

  const memories = await getMemories(queryClient, id);
  return NextResponse.json({ data: memories });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id: _id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();

  const { searchParams } = new URL(request.url);
  const memoryId = searchParams.get('memoryId');

  if (!memoryId) return NextResponse.json({ error: 'memoryId is required' }, { status: 400 });

  await deleteMemory(queryClient, memoryId);
  return NextResponse.json({ ok: true });
}
