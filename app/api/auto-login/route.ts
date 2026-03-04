import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { createStaticAdminClient } from '@/lib/supabase/server';

/**
 * GET /api/auto-login
 *
 * Temporary endpoint: bypasses password-based login by generating a magic-link
 * token via the Admin API and immediately verifying it server-side, which sets
 * the session cookies.  After configuration is done, REMOVE this file.
 */
export async function GET() {
  try {
    const admin = createStaticAdminClient();
    const ORG_ID = '828ac44c-36a6-4be9-b0cb-417c4314ab8b';

    // ── 1. List existing users ──────────────────────────────────────────
    const {
      data: { users },
      error: listErr,
    } = await admin.auth.admin.listUsers();

    if (listErr) {
      return NextResponse.json({ step: 'listUsers', error: listErr.message }, { status: 500 });
    }

    let targetUser = users?.[0];

    // ── 2. If no user exists, create one ────────────────────────────────
    if (!targetUser) {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: 'admin@fullhouse.com.br',
        password: 'Admin123456',
        email_confirm: true,
        user_metadata: { role: 'admin', organization_id: ORG_ID },
      });

      if (createErr) {
        return NextResponse.json({ step: 'createUser', error: createErr.message }, { status: 500 });
      }
      targetUser = created.user;
    }

    // ── 3. Ensure email is confirmed ────────────────────────────────────
    await admin.auth.admin.updateUserById(targetUser.id, { email_confirm: true });

    // ── 4. Ensure profile exists ────────────────────────────────────────
    const { error: profileErr } = await admin.from('profiles').upsert(
      {
        id: targetUser.id,
        email: targetUser.email,
        name: targetUser.email?.split('@')[0] ?? 'Admin',
        first_name: 'Admin',
        organization_id: ORG_ID,
        role: 'admin',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );

    if (profileErr) {
      return NextResponse.json({ step: 'profile', error: profileErr.message }, { status: 500 });
    }

    // ── 5. Generate magic-link token (no email sent, just the token) ───
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: targetUser.email!,
    });

    if (linkErr) {
      return NextResponse.json({ step: 'generateLink', error: linkErr.message }, { status: 500 });
    }

    const tokenHash = linkData.properties.hashed_token;

    // ── 6. Verify the OTP server-side → session cookies are set ────────
    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        },
      },
    });

    const { error: verifyErr } = await supabase.auth.verifyOtp({
      type: 'magiclink',
      token_hash: tokenHash,
    });

    if (verifyErr) {
      return NextResponse.json(
        {
          step: 'verifyOtp',
          error: verifyErr.message,
          user: targetUser.email,
          hint: 'Token verification failed. Check Supabase Auth settings.',
        },
        { status: 500 },
      );
    }

    // ── 7. Redirect to dashboard ────────────────────────────────────────
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://nossocrm-five.vercel.app';

    return NextResponse.redirect(new URL('/dashboard', baseUrl));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ step: 'unexpected', error: message }, { status: 500 });
  }
}
