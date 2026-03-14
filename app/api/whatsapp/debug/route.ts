import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { getEvolutionCredentials, getEvolutionGlobalConfig } from '@/lib/evolution/helpers';
import * as evolution from '@/lib/evolution/client';

/** Debug endpoint to inspect Evolution API and DB state */
export async function GET() {
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

  const adminSupabase = createStaticAdminClient();

  // 1. Check instances in DB
  const { data: instances, error: instancesError } = await adminSupabase
    .from('whatsapp_instances')
    .select('*')
    .eq('organization_id', profile.organization_id);

  // 2. Check conversations in DB
  const { data: conversations, error: convsError } = await adminSupabase
    .from('whatsapp_conversations')
    .select('id, phone, contact_name, instance_id, last_message_at')
    .eq('organization_id', profile.organization_id)
    .limit(10);

  // 3. Check messages in DB
  const { data: messages, error: msgsError } = await adminSupabase
    .from('whatsapp_messages')
    .select('id, conversation_id, from_me, message_type, text_body')
    .eq('organization_id', profile.organization_id)
    .limit(5);

  // 4. Try to call Evolution API findChats
  let evoChats: unknown = null;
  let evoError: string | null = null;
  let evoCreds: unknown = null;

  if (instances && instances.length > 0) {
    const instance = instances[0];
    try {
      const creds = await getEvolutionCredentials(adminSupabase, instance);
      evoCreds = { baseUrl: creds.baseUrl, instanceName: creds.instanceName, apiKeyLength: creds.apiKey?.length };
      const chats = await evolution.findChats(creds);
      evoChats = {
        type: typeof chats,
        isArray: Array.isArray(chats),
        length: Array.isArray(chats) ? chats.length : 'N/A',
        sample: Array.isArray(chats) ? chats.slice(0, 3) : chats,
      };
    } catch (e) {
      evoError = e instanceof Error ? e.message : String(e);
    }
  }

  return NextResponse.json({
    instances: { data: instances, error: instancesError?.message },
    conversations: { data: conversations, error: convsError?.message, count: conversations?.length },
    messages: { data: messages, error: msgsError?.message, count: messages?.length },
    evolutionApi: { chats: evoChats, error: evoError, credentials: evoCreds },
  });
}
