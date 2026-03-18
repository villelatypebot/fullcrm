import { createClient } from '@supabase/supabase-js';
// No node-fetch needed

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

async function main() {
  const { data: convs, error } = await supabase
    .from('whatsapp_conversations')
    .select('id, phone, instance_id, contact_photo, is_group, organization_id')
    .is('contact_photo', null)
    .eq('is_group', false)
    .order('last_message_at', { ascending: false })
    .limit(500);
    
  if (error || !convs) {
    console.error('Error fetching conversations:', error);
    return;
  }

  console.log(`Found ${convs.length} conversations missing photos...`);

  // Map instance_id to API details
  const instances = new Map();

  for (const conv of convs) {
    if (!instances.has(conv.instance_id)) {
      const { data: inst } = await supabase
        .from('whatsapp_instances')
        .select('evolution_instance_name, instance_token, organization_id, instance_id')
        .eq('id', conv.instance_id)
        .single();
      
      if (!inst) continue;

      const { data: org } = await supabase
        .from('organization_settings')
        .select('evolution_api_url')
        .eq('organization_id', inst.organization_id)
        .single();
      
      instances.set(conv.instance_id, {
        baseUrl: org?.evolution_api_url,
        apiKey: inst.instance_token,
        instanceName: inst.evolution_instance_name || inst.instance_id,
      });
    }

    const creds = instances.get(conv.instance_id);
    if (!creds?.baseUrl) continue;

    const jid = `${conv.phone}@s.whatsapp.net`;
    const apiUrl = `${creds.baseUrl}/chat/fetchProfilePictureUrl/${creds.instanceName}`;
    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': creds.apiKey
        },
        body: JSON.stringify({ number: jid })
      });
      const data: any = await resp.json();
      
      if (data?.profilePictureUrl) {
        console.log(`[Success] Found photo for ${conv.phone}`);
        await supabase
          .from('whatsapp_conversations')
          .update({ contact_photo: data.profilePictureUrl })
          .eq('id', conv.id);
      } else {
        console.log(`[Skipped] No photo for ${conv.phone}:`, data);
      }
    } catch (e: any) {
      console.log(`[Error] Failed to fetch photo for ${conv.phone}:`, e.message);
    }
  }

  console.log('Done.');
}
main();
