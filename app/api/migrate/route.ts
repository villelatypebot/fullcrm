import { NextResponse } from 'next/server';
import { Pool } from 'pg';
import { createStaticAdminClient } from '@/lib/supabase/server';

/**
 * Temporary migration endpoint.
 * POST /api/migrate?secret=fullcrm-migrate-2024
 *
 * Body: { "db_password": "your-database-password" }
 *
 * Runs DDL migrations using direct Postgres connection.
 * Remove this endpoint after migrations are complete.
 */
export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');

  if (secret !== 'fullcrm-migrate-2024') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const dbPassword = body.db_password;

  if (!dbPassword) {
    // No password provided - just check column status
    const supabase = createStaticAdminClient();
    const checks = [
      { table: 'contacts', column: 'temperature' },
      { table: 'contacts', column: 'lead_score' },
      { table: 'contacts', column: 'buying_stage' },
      { table: 'whatsapp_ai_config', column: 'follow_up_sequence' },
      { table: 'organization_settings', column: 'reservation_supabase_url' },
      { table: 'organization_settings', column: 'reservation_supabase_key' },
    ];

    const columnStatus: Record<string, boolean> = {};
    for (const check of checks) {
      const { error } = await supabase.from(check.table).select(check.column).limit(0);
      columnStatus[`${check.table}.${check.column}`] = !error;
    }

    const missing = Object.entries(columnStatus).filter(([, exists]) => !exists);
    return NextResponse.json({
      status: missing.length > 0 ? 'migrations_needed' : 'all_up_to_date',
      columns: columnStatus,
      hint: 'Pass db_password in request body to run migrations',
    });
  }

  // Extract project ref from Supabase URL
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
  if (!projectRef) {
    return NextResponse.json({ error: 'Cannot determine project ref from SUPABASE_URL' }, { status: 500 });
  }

  // Connect to Postgres directly using the pooler
  const pool = new Pool({
    host: `aws-0-us-east-1.pooler.supabase.com`,
    port: 6543,
    database: 'postgres',
    user: `postgres.${projectRef}`,
    password: dbPassword,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15000,
  });

  const results: Array<{ sql: string; ok: boolean; error?: string }> = [];

  try {
    // Test connection
    await pool.query('SELECT 1');
    results.push({ sql: 'Connection test', ok: true });
  } catch (err) {
    // Try different regions
    pool.end();

    for (const region of ['sa-east-1', 'us-west-1', 'eu-west-1']) {
      const altPool = new Pool({
        host: `aws-0-${region}.pooler.supabase.com`,
        port: 6543,
        database: 'postgres',
        user: `postgres.${projectRef}`,
        password: dbPassword,
        ssl: { rejectUnauthorized: false },
        max: 1,
        connectionTimeoutMillis: 10000,
      });

      try {
        await altPool.query('SELECT 1');
        results.push({ sql: `Connection test (${region})`, ok: true });
        // Found working region, use this pool
        return await runMigrations(altPool, results);
      } catch {
        altPool.end();
      }
    }

    // Try direct connection as last resort
    const directPool = new Pool({
      host: `db.${projectRef}.supabase.co`,
      port: 5432,
      database: 'postgres',
      user: 'postgres',
      password: dbPassword,
      ssl: { rejectUnauthorized: false },
      max: 1,
      connectionTimeoutMillis: 15000,
    });

    try {
      await directPool.query('SELECT 1');
      results.push({ sql: 'Connection test (direct)', ok: true });
      return await runMigrations(directPool, results);
    } catch (directErr) {
      directPool.end();
      return NextResponse.json({
        error: 'Could not connect to database',
        details: err instanceof Error ? err.message : String(err),
        directDetails: directErr instanceof Error ? directErr.message : String(directErr),
      }, { status: 500 });
    }
  }

  return await runMigrations(pool, results);
}

async function runMigrations(
  pool: Pool,
  results: Array<{ sql: string; ok: boolean; error?: string }>,
) {
  const migrations = [
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS temperature text DEFAULT 'cold'",
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_score integer DEFAULT 0",
    "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS buying_stage text DEFAULT 'awareness'",
    "ALTER TABLE whatsapp_ai_config ADD COLUMN IF NOT EXISTS follow_up_sequence jsonb DEFAULT '[{\"delay_minutes\":30,\"label\":\"Primeiro contato\"},{\"delay_minutes\":60,\"label\":\"Segundo contato\"},{\"delay_minutes\":180,\"label\":\"Terceiro contato\"}]'::jsonb",
    "ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS reservation_supabase_url text",
    "ALTER TABLE organization_settings ADD COLUMN IF NOT EXISTS reservation_supabase_key text",
  ];

  for (const sql of migrations) {
    try {
      await pool.query(sql);
      results.push({ sql: sql.slice(0, 80) + '...', ok: true });
    } catch (err) {
      results.push({ sql: sql.slice(0, 80) + '...', ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Backfill existing lead scores into contacts
  try {
    const backfillResult = await pool.query(`
      UPDATE contacts c
      SET temperature = ls.temperature,
          lead_score = ls.score,
          buying_stage = ls.buying_stage
      FROM whatsapp_lead_scores ls
      WHERE ls.contact_id = c.id
        AND ls.contact_id IS NOT NULL
    `);
    results.push({ sql: 'Backfill lead scores', ok: true, error: `${backfillResult.rowCount} rows updated` });
  } catch (err) {
    results.push({ sql: 'Backfill lead scores', ok: false, error: err instanceof Error ? err.message : String(err) });
  }

  await pool.end();
  return NextResponse.json({ status: 'migrations_complete', results });
}
