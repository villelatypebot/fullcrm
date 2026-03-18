import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!
);

async function testRealtime() {
  console.log('Connecting to realtime...');
  const channel = supabase.channel('system-test');
  
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'whatsapp_messages' },
    (payload) => console.log('REALTIME PAYLOAD (messages):', payload)
  );
  
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'whatsapp_conversations' },
    (payload) => console.log('REALTIME PAYLOAD (conversations):', payload)
  );

  channel.subscribe(async (status) => {
    console.log('Subscribe status:', status);
    
    if (status === 'SUBSCRIBED') {
      console.log('Subscribed! Now let\'s trigger a fake message insert to see if we get it...');
      
      const { data: conv } = await supabase
        .from('whatsapp_conversations')
        .select('*')
        .limit(1)
        .single();
        
      if (!conv) {
        console.log('No convs found to test.');
        process.exit(0);
      }
        
      const { data: msg, error: insErr } = await supabase.from('whatsapp_messages').insert({
        conversation_id: conv.id,
        organization_id: conv.organization_id,
        from_me: true,
        message_type: 'system',
        text_body: 'realtime config test',
        status: 'pending'
      }).select().single();
      
      console.log('Inserted msg id:', msg?.id, 'Err:', insErr?.message);
      
      // wait a bit for realtime to catch it
      setTimeout(async () => {
        if (msg) {
          // cleanup
          await supabase.from('whatsapp_messages').delete().eq('id', msg.id);
          console.log('Cleaned up.');
        }
        process.exit(0);
      }, 3000);
    }
  });

}

testRealtime();
