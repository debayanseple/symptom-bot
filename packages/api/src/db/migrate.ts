import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closePool, pool } from './pool.js';
import { logger } from '../logger.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/**
 * Minimal forward-only migration runner. Each .sql file runs once, inside a
 * transaction, in filename order. No down-migrations by design — at this stage
 * rolling back means dropping the database and re-ingesting, which takes
 * minutes.
 */
export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await pool.query<{ filename: string }>('SELECT filename FROM schema_migrations')).rows.map(
      (r) => r.filename,
    ),
  );

  const files = (await fs.readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

  let ran = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = await fs.readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await client.query('COMMIT');
      logger.info(`applied migration ${file}`);
      ran += 1;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw new Error(`migration ${file} failed: ${String(error)}`);
    } finally {
      client.release();
    }
  }

  logger.info(ran === 0 ? 'database already up to date' : `applied ${ran} migration(s)`);
}

// Run directly: `npm run db:migrate`
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('migrate.ts')) {
  migrate()
    .then(closePool)
    .catch(async (error) => {
      logger.error({ err: String(error) }, 'migration failed');
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
