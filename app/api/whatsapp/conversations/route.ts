import { NextResponse, type NextRequest } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getConversations } from '@/lib/supabase/whatsapp';

// TEMPORARY: fallback org ID when auth is bypassed
const FALLBACK_ORG_ID = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';

/** List WhatsApp conversations */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();
  let orgId: string;

  if (!user) {
    orgId = FALLBACK_ORG_ID;
  } else {
    const { data: profile } = await supabase
      .from('profiles')
      .select('organization_id')
      .eq('id', user.id)
      .single();

    if (!profile?.organization_id) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    }
    orgId = profile.organization_id;
  }

  const searchParams = request.nextUrl.searchParams;
  const conversations = await getConversations(queryClient, orgId, {
    instanceId: searchParams.get('instanceId') ?? undefined,
    status: searchParams.get('status') ?? undefined,
    search: searchParams.get('search') ?? undefined,
    limit: Number(searchParams.get('limit')) || 50,
  });

  return NextResponse.json({ data: conversations });
}
