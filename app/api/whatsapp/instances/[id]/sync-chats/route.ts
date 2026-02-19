import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import * as zapi from '@/lib/zapi/client';

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/whatsapp/instances/[id]/sync-chats
 *
 * Fetches existing chats from Z-API and imports them as conversations.
 * Useful when the webhook missed messages or when the instance was
 * connected before webhooks were configured.
 */
export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
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

  // Get the instance
  const { data: instance } = await supabase
    .from('whatsapp_instances')
    .select('*')
    .eq('id', id)
    .eq('organization_id', profile.organization_id)
    .single();

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
  }

  const creds: zapi.ZApiCredentials = {
    instanceId: instance.instance_id,
    token: instance.instance_token,
    clientToken: instance.client_token ?? undefined,
  };

  try {
    // Fetch chats from Z-API
    const chats = await zapi.getChats(creds);
    if (!chats || !Array.isArray(chats)) {
      return NextResponse.json({ data: { synced: 0 }, message: 'Nenhum chat encontrado na Z-API.' });
    }

    // Use admin client for writing (bypass RLS)
    const adminSupabase = createStaticAdminClient();
    let synced = 0;

    for (const chat of chats) {
      // Skip groups for now
      if (chat.isGroup) continue;
      // Skip if no phone
      if (!chat.phone) continue;

      // Clean phone number (remove @c.us suffix if present)
      const phone = chat.phone.replace(/@.*$/, '');

      // Check if conversation already exists
      const { data: existing } = await adminSupabase
        .from('whatsapp_conversations')
        .select('id')
        .eq('instance_id', instance.id)
        .eq('phone', phone)
        .single();

      if (existing) continue; // Already imported

      // Create the conversation
      const { error: insertError } = await adminSupabase
        .from('whatsapp_conversations')
        .insert({
          instance_id: instance.id,
          organization_id: profile.organization_id,
          phone,
          contact_name: chat.name || undefined,
          is_group: false,
          unread_count: chat.unreadMessages || 0,
          last_message_at: chat.lastMessageTimestamp
            ? new Date(chat.lastMessageTimestamp * 1000).toISOString()
            : new Date().toISOString(),
        });

      if (insertError) {
        console.error('[sync-chats] Error inserting conversation for phone:', phone, insertError.message);
        continue;
      }

      synced++;
    }

    return NextResponse.json({
      data: { synced, total: chats.length },
      message: synced > 0
        ? `${synced} conversa(s) sincronizada(s) com sucesso!`
        : 'Todas as conversas já estão sincronizadas.',
    });
  } catch (err) {
    console.error('[sync-chats] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Falha ao sincronizar chats' },
      { status: 500 },
    );
  }
}
