import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getInstance } from '@/lib/supabase/whatsapp';
import * as zapi from '@/lib/zapi/client';

type Params = { params: Promise<{ id: string }> };

/** Get QR code for WhatsApp connection */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const instance = await getInstance(supabase, id);
  if (!instance) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  try {
    const qr = await zapi.getQrCode({
      instanceId: instance.instance_id,
      token: instance.instance_token,
      clientToken: instance.client_token ?? undefined,
    });

    return NextResponse.json({ data: qr });
  } catch (err) {
    return NextResponse.json(
      { error: 'Não foi possível obter o QR Code. Verifique se a instância está ativa no Z-API.' },
      { status: 502 },
    );
  }
}
