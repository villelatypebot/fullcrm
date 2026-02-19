import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getConversations } from '@/lib/supabase/whatsapp';

/** List WhatsApp conversations */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('profiles')
    .select('organization_id')
    .eq('id', user.id)
    .single();

  if (!profile?.organization_id) {
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
  }

  const searchParams = request.nextUrl.searchParams;
  const conversations = await getConversations(supabase, profile.organization_id, {
    instanceId: searchParams.get('instanceId') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    limit: Number(searchParams.get('limit')) || 50,
  });

  return NextResponse.json({ data: conversations });
}
