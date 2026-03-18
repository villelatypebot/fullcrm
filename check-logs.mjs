import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://yldnqpxtzoglqfosykhd.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlsZG5xcHh0em9nbHFmb3N5a2hkIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTUxMzQ2MiwiZXhwIjoyMDg3MDg5NDYyfQ.mNZS0v7MC2LLjLAlBsiz7f0mHpE7TPtwGtStxQvVg1U'
);

async function run() {
  const { data: logs } = await supabase
    .from('ai_logs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('AI LOGS:', JSON.stringify(logs, null, 2));

  const { data: msgs } = await supabase
    .from('whatsapp_messages')
    .select('id, text_body, from_me, created_at')
    .order('created_at', { ascending: false })
    .limit(10);
  console.log('MSGS:', JSON.stringify(msgs, null, 2));
}
run();
