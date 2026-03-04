import { NextResponse } from 'next/server';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { getInstance } from '@/lib/supabase/whatsapp';
import { getEvolutionCredentials } from '@/lib/evolution/helpers';
import * as evolution from '@/lib/evolution/client';

type Params = { params: Promise<{ id: string }> };

/** Get QR code for WhatsApp connection */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  // TEMPORARY: bypass auth
  const queryClient = user ? supabase : createStaticAdminClient();

  const instance = await getInstance(queryClient, id);
  if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const creds = await getEvolutionCredentials(queryClient, instance);
    const result = await evolution.connectInstance(creds);

    return NextResponse.json({
      data: {
        value: result.base64 || result.code || '',
        connected: false,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Não foi possível obter o QR Code. Verifique se a instância está ativa na Evolution API.' },
      { status: 502 },
    );
  }
}
