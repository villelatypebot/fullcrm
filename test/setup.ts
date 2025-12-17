import { loadEnvFile } from './helpers/env';
import { cleanupFixtures } from './helpers/fixtures';
import { getRunId } from './helpers/runId';

// Next.js server/client boundary helpers.
// In runtime do Next, `server-only` previne import acidental em Client Components.
// Em testes Node (Vitest), queremos que seja um no-op.
import { vi } from 'vitest';
vi.mock('server-only', () => ({}));

// Prefer envs from THIS project folder so crmia-next can be moved to its own repo.
// (When running inside the monorepo, we keep the old root .env as a fallback.)
loadEnvFile(new URL('../.env', import.meta.url).pathname);
loadEnvFile(new URL('../.env.local', import.meta.url).pathname, { override: true });

// Monorepo fallback (no override)
loadEnvFile(new URL('../../.env', import.meta.url).pathname);
loadEnvFile(new URL('../../.env.local', import.meta.url).pathname);

// Best-effort cleanup: if a prior run crashed, make a quick attempt to remove leftovers.
// This won't block tests if cleanup fails (it can fail due to missing tables in dev).
beforeAll(async () => {
  const runId = getRunId('next-ai');
  try {
    await cleanupFixtures(runId);
  } catch {
    // ignore
  }
});

afterAll(async () => {
  const runId = getRunId('next-ai');
  try {
    await cleanupFixtures(runId);
  } catch {
    // ignore
  }
});
