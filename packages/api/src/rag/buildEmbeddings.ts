import { config } from '../config.js';
import { closePool, query, withTransaction } from '../db/pool.js';
import { logger } from '../logger.js';
import { disposeEmbedder, embed, toVectorLiteral } from './embedder.js';

/**
 * Batch job: embed every facility that does not yet have a current vector.
 * Runs after ingestion. Idempotent — re-running only touches rows whose text
 * changed or whose embedding was built by a different model.
 */
export async function buildEmbeddings({ batchSize = 64 } = {}): Promise<number> {
  const { rows } = await query<{ id: string; text_chunk: string }>(
    `
    SELECT f.id,
           concat_ws(' ',
             f.name,
             f.description,
             CASE WHEN array_length(f.specialty_tags, 1) > 0
                  THEN 'Specialties: ' || array_to_string(f.specialty_tags, ', ')
             END,
             f.address
           ) AS text_chunk
    FROM facilities f
    LEFT JOIN facility_embeddings e
           ON e.facility_id = f.id AND e.chunk_index = 0
    WHERE e.id IS NULL
       OR e.model <> $1
       OR e.text_chunk IS DISTINCT FROM concat_ws(' ',
             f.name,
             f.description,
             CASE WHEN array_length(f.specialty_tags, 1) > 0
                  THEN 'Specialties: ' || array_to_string(f.specialty_tags, ', ')
             END,
             f.address
           )
    `,
    [config.rag.model],
  );

  if (rows.length === 0) {
    logger.info('all facility embeddings are up to date');
    return 0;
  }

  logger.info(`embedding ${rows.length} facilities in batches of ${batchSize}`);
  let written = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const vectors = await embed(batch.map((row) => row.text_chunk));

    await withTransaction(async (client) => {
      for (const [index, row] of batch.entries()) {
        const vector = vectors[index];
        if (!vector) continue;
        await client.query(
          `
          INSERT INTO facility_embeddings (facility_id, chunk_index, text_chunk, embedding, model)
          VALUES ($1, 0, $2, $3::vector, $4)
          ON CONFLICT (facility_id, chunk_index) DO UPDATE SET
            text_chunk = EXCLUDED.text_chunk,
            embedding  = EXCLUDED.embedding,
            model      = EXCLUDED.model,
            created_at = now()
          `,
          [row.id, row.text_chunk, toVectorLiteral(vector), config.rag.model],
        );
        written += 1;
      }
    });

    logger.info(`embedded ${Math.min(i + batchSize, rows.length)}/${rows.length}`);
  }

  // The IVFFlat index needs statistics to pick sensible probe lists.
  await query('ANALYZE facility_embeddings');
  return written;
}

if (process.argv[1]?.endsWith('buildEmbeddings.ts') || process.argv[1]?.endsWith('buildEmbeddings.js')) {
  buildEmbeddings()
    .then(async (count) => {
      logger.info(`wrote ${count} embeddings`);
      await disposeEmbedder();
      await closePool();
    })
    .catch(async (error) => {
      logger.error({ err: String(error) }, 'embedding build failed');
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
