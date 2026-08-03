import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { handleChat } from '../pipeline/orchestrator.js';
import { detectRedFlags } from '../triage/redFlags.js';

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  location: z
    .object({
      lat: z.number().min(-90).max(90),
      lon: z.number().min(-180).max(180),
    })
    .optional(),
  locationText: z.string().max(200).optional(),
  radiusKm: z.number().positive().max(100).optional(),
  sessionId: z.string().max(64).optional(),
});

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/chat', async (request, reply) => {
    const parsed = chatSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'invalid_request',
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const response = await handleChat(parsed.data);
    return reply.send(response);
  });

  /**
   * Triage-only endpoint. Exposed separately so the red-flag layer can be
   * tested, monitored and audited without running the rest of the pipeline.
   */
  app.post('/api/triage', async (request, reply) => {
    const parsed = z.object({ message: z.string().min(1).max(4000) }).safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request' });
    }
    return reply.send(detectRedFlags(parsed.data.message));
  });
}
