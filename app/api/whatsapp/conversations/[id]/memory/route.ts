import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const memories = await getMemories(supabase, id);
  return NextResponse.json({ data: memories });
}

export async function DELETE(request: Request, { params }: Params) {
  const { id: _id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const memoryId = searchParams.get('memoryId');

  if (!memoryId) return NextResponse.json({ error: 'memoryId is required' }, { status: 400 });

  await deleteMemory(supabase, memoryId);
  return NextResponse.json({ ok: true });
}
