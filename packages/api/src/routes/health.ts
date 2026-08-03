import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { healthCheck as ollamaHealth } from '../llm/ollamaClient.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => reply.send({ status: 'ok' }));

  /**
   * Deep health check. Reports degraded rather than down when only the
   * optional layers (LLM, embeddings) are unavailable — the MVP is designed to
   * keep serving on rules + geo alone.
   */
  app.get('/health/ready', async (_request, reply) => {
    const [database, embeddings] = await Promise.all([
      query('SELECT 1').then(
        () => ({ ok: true, detail: 'connected' }),
        (error: unknown) => ({ ok: false, detail: String(error) }),
      ),
      query<{ count: number }>('SELECT count(*)::int AS count FROM facility_embeddings').then(
        (result) => ({ ok: true, detail: `${result.rows[0]?.count ?? 0} vectors` }),
        (error: unknown) => ({ ok: false, detail: String(error) }),
      ),
    ]);

    const llm = await ollamaHealth();

    const status = !database.ok ? 'down' : llm.ok && embeddings.ok ? 'ok' : 'degraded';

    return reply.status(database.ok ? 200 : 503).send({
      status,
      checks: {
        database,
        llm: { ...llm, model: config.llm.model, enabled: config.llm.enabled },
        embeddings: { ...embeddings, model: config.rag.model, enabled: config.rag.enabled },
      },
      // Triage is pure code with no dependencies — it is always available, and
      // that is the point of keeping it deterministic.
      triage: { ok: true, detail: 'deterministic, no external dependencies' },
    });
  });
}
