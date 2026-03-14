import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createStaticAdminClient } from '@/lib/supabase/server';
import { getEvolutionCredentials } from '@/lib/evolution/helpers';

/**
 * Debug endpoint to test message fetching from Evolution API
 * GET /api/whatsapp/debug-messages?conversationId=xxx
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const adminSupabase = createStaticAdminClient();
  const url = new URL(request.url);
  const conversationId = url.searchParams.get('conversationId');

  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 400 });
  }

  // Get conversation
  const { data: conversation, error: convErr } = await adminSupabase
    .from('whatsapp_conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found', details: convErr?.message }, { status: 404 });
  }

  // Get instance
  const { data: instance, error: instErr } = await adminSupabase
    .from('whatsapp_instances')
    .select('*')
    .eq('id', conversation.instance_id)
    .single();

  if (!instance) {
    return NextResponse.json({ error: 'Instance not found', details: instErr?.message }, { status: 404 });
  }

  // Get credentials and do a RAW fetch
  try {
    const creds = await getEvolutionCredentials(adminSupabase, instance);
    const remoteJid = `${conversation.phone}@s.whatsapp.net`;
    
    // RAW fetch - no parsing, no encoding
    const rawUrl = `${creds.baseUrl}/chat/findMessages/${creds.instanceName}`;
    const encodedUrl = `${creds.baseUrl}/chat/findMessages/${encodeURIComponent(creds.instanceName)}`;
    
    const rawRes = await fetch(rawUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': creds.apiKey,
      },
      body: JSON.stringify({
        where: { key: { remoteJid } },
      }),
    });
    const rawText = await rawRes.text();
    
    let rawParsed: unknown;
    try { rawParsed = JSON.parse(rawText); } catch { rawParsed = rawText; }
    
    const isObj = rawParsed && typeof rawParsed === 'object' && !Array.isArray(rawParsed);
    const topKeys = isObj ? Object.keys(rawParsed as Record<string, unknown>) : [];
    
    // Detailed inspection of 'messages' field
    const messagesField = isObj ? (rawParsed as Record<string, unknown>).messages : null;
    const messagesIsArray = Array.isArray(messagesField);
    const messagesIsObj = messagesField && typeof messagesField === 'object' && !Array.isArray(messagesField);
    const messagesTopKeys = messagesIsObj ? Object.keys(messagesField as Record<string, unknown>) : [];
    const messagesRecords = messagesIsObj ? (messagesField as Record<string, unknown>).records : null;
    const messagesRecordsIsArray = Array.isArray(messagesRecords);
    
    return NextResponse.json({
      conversation: { id: conversation.id, phone: conversation.phone },
      credentials: { instanceName: creds.instanceName },
      remoteJid,
      rawFetch: {
        status: rawRes.status,
        textLength: rawText.length,
        topKeys,
      },
      messagesField: {
        type: typeof messagesField,
        isArray: messagesIsArray,
        isObject: messagesIsObj,
        length: messagesIsArray ? (messagesField as unknown[]).length : 'N/A',
        topKeys: messagesTopKeys,
        total: messagesIsObj ? (messagesField as Record<string, unknown>).total : undefined,
        recordsIsArray: messagesRecordsIsArray,
        recordsLength: messagesRecordsIsArray ? (messagesRecords as unknown[]).length : 'N/A',
        firstRecordKey: messagesRecordsIsArray && (messagesRecords as unknown[]).length > 0 
          ? ((messagesRecords as unknown[])[0] as any)?.key?.id
          : null,
      },
    });
  } catch (err) {
    return NextResponse.json({
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }, { status: 500 });
  }
}
