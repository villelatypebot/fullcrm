import { z } from 'zod';
import { createClient, createStaticAdminClient } from '@/lib/supabase/server';
import { isAllowedOrigin } from '@/lib/security/sameOrigin';

// TEMPORARY: fallback org ID when auth is bypassed
const FALLBACK_ORG_ID = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
  });
}

const UpdateEvolutionSettingsSchema = z
  .object({
    evolutionApiUrl: z
      .string()
      .url()
      .optional(),
    evolutionApiKey: z.string().optional(),
  })
  .strict();

/**
 * Handler HTTP `GET` deste endpoint (Next.js Route Handler).
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function GET() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // TEMPORARY: when auth is bypassed, use admin client with fallback org
  let orgId: string;
  let isAdmin = true;

  if (!user) {
    orgId = FALLBACK_ORG_ID;
  } else {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.organization_id) {
      return json({ error: 'Profile not found' }, 404);
    }
    orgId = profile.organization_id;
    isAdmin = profile.role === 'admin';
  }

  // Use admin client to bypass RLS when no session
  const queryClient = user ? supabase : createStaticAdminClient();

  const { data: orgSettings, error: orgError } = await queryClient
    .from('organization_settings')
    .select('evolution_api_url, evolution_api_key')
    .eq('organization_id', orgId)
    .maybeSingle();

  if (orgError) {
    return json({ error: orgError.message }, 500);
  }

  if (!isAdmin) {
    return json({
      evolutionApiUrl: orgSettings?.evolution_api_url || '',
      evolutionApiKey: '',
      hasKey: Boolean(orgSettings?.evolution_api_key),
    });
  }

  return json({
    evolutionApiUrl: orgSettings?.evolution_api_url || '',
    evolutionApiKey: orgSettings?.evolution_api_key || '',
    hasKey: Boolean(orgSettings?.evolution_api_key),
  });
}

/**
 * Handler HTTP `POST` deste endpoint (Next.js Route Handler).
 *
 * @param {Request} req - Objeto da requisicao.
 * @returns {Promise<Response>} Retorna um valor do tipo `Promise<Response>`.
 */
export async function POST(req: Request) {
  // Mitigacao CSRF: endpoint autenticado por cookies.
  if (!isAllowedOrigin(req)) {
    return json({ error: 'Forbidden' }, 403);
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // TEMPORARY: when auth is bypassed, use admin client with fallback org
  let orgId: string;

  if (!user) {
    orgId = FALLBACK_ORG_ID;
  } else {
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('organization_id, role')
      .eq('id', user.id)
      .single();

    if (profileError || !profile?.organization_id) {
      return json({ error: 'Profile not found' }, 404);
    }

    if (profile.role !== 'admin') {
      return json({ error: 'Forbidden' }, 403);
    }
    orgId = profile.organization_id;
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = UpdateEvolutionSettingsSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json({ error: 'Invalid payload', details: parsed.error.flatten() }, 400);
  }

  const updates = parsed.data;

  // Normalize empty-string values to null
  const normalize = (value: string | undefined) => {
    if (value === undefined) return undefined;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  };

  const dbUpdates: Record<string, unknown> = {
    organization_id: orgId,
    updated_at: new Date().toISOString(),
  };

  const apiUrl = normalize(updates.evolutionApiUrl);
  if (apiUrl !== undefined) dbUpdates.evolution_api_url = apiUrl;

  const apiKey = normalize(updates.evolutionApiKey);
  if (apiKey !== undefined) dbUpdates.evolution_api_key = apiKey;

  // Use admin client to bypass RLS when no session
  const queryClient = user ? supabase : createStaticAdminClient();

  const { error: upsertError } = await queryClient
    .from('organization_settings')
    .upsert(dbUpdates, { onConflict: 'organization_id' });

  if (upsertError) {
    return json({ error: upsertError.message }, 500);
  }

  return json({ ok: true });
}
