import fs from 'fs';
import path from 'path';
import { Client } from 'pg';

const SCHEMA_PATH = path.resolve(
  process.cwd(),
  'supabase/migrations/20251201000000_schema_init.sql'
);

function needsSsl(connectionString: string) {
  return !/sslmode=disable/i.test(connectionString);
}

function stripSslModeParam(connectionString: string) {
  // Some drivers/envs treat `sslmode=require` inconsistently. We control SSL via `Client({ ssl })`.
  try {
    const url = new URL(connectionString);
    url.searchParams.delete('sslmode');
    return url.toString();
  } catch {
    return connectionString;
  }
}

/**
 * Função pública `runSchemaMigration` do projeto.
 *
 * @param {string} dbUrl - Parâmetro `dbUrl`.
 * @returns {Promise<void>} Retorna uma Promise resolvida sem valor.
 */
export async function runSchemaMigration(dbUrl: string) {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf8');
  const normalizedDbUrl = stripSslModeParam(dbUrl);

  const client = new Client({
    connectionString: normalizedDbUrl,
    // NOTE: Supabase DB uses TLS; on some networks a MITM/corporate proxy can inject a cert chain
    // that Node doesn't trust. For the installer/migrations step we prefer "no-verify" over failure.
    ssl: needsSsl(dbUrl) ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    await client.query(schemaSql);
  } finally {
    await client.end();
  }
}
