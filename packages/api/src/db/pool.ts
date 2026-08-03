import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../logger.js';

const { Pool } = pg;

// Postgres returns NUMERIC as a string to preserve precision. Every numeric in
// this schema (distances, scores) fits a double comfortably, so parse them.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number(value));

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Managed free tiers (Supabase, Neon) require TLS but use certs Node does not
  // trust out of the box.
  ssl: /supabase|neon|render|railway/.test(config.databaseUrl)
    ? { rejectUnauthorized: false }
    : undefined,
});

pool.on('error', (error) => {
  logger.error({ err: String(error) }, 'idle postgres client error');
});

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const started = Date.now();
  try {
    return await pool.query<T>(text, params);
  } finally {
    const elapsed = Date.now() - started;
    if (elapsed > 500) {
      logger.warn({ elapsed, sql: text.slice(0, 120) }, 'slow query');
    }
  }
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
