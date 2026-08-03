import type { FastifyInstance } from 'fastify';
import { isSpecialty } from '@calldoc/shared';
import { z } from 'zod';
import { config } from '../config.js';
import { countFacilities, findNearby, getFacilityById } from '../geo/facilityRepo.js';
import { CITIES } from '../ingest/cities.js';

const nearbySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(100).optional(),
  specialty: z.string().optional(),
  emergencyOnly: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export async function facilityRoutes(app: FastifyInstance): Promise<void> {
  /** Raw structured search — no NLU, no RAG. Useful for debugging coverage. */
  app.get('/api/facilities/nearby', async (request, reply) => {
    const parsed = nearbySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_request', issues: parsed.error.issues });
    }

    const { lat, lon, radiusKm, specialty, emergencyOnly, limit } = parsed.data;
    if (specialty && !isSpecialty(specialty)) {
      return reply.status(400).send({ error: 'unknown_specialty', specialty });
    }

    const facilities = await findNearby({
      centre: { lat, lon },
      radiusKm: radiusKm ?? config.search.defaultRadiusKm,
      ...(specialty && isSpecialty(specialty) ? { specialty } : {}),
      ...(emergencyOnly ? { emergencyOnly: true } : {}),
      limit: limit ?? 20,
    });

    return reply.send({ count: facilities.length, facilities });
  });

  app.get('/api/facilities/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!/^\d+$/.test(id)) return reply.status(400).send({ error: 'invalid_id' });

    const facility = await getFacilityById(id);
    if (!facility) return reply.status(404).send({ error: 'not_found' });
    return reply.send(facility);
  });

  /** Coverage report — which cities are ingested and how many records each has. */
  app.get('/api/coverage', async (_request, reply) => {
    const cities = await Promise.all(
      Object.values(CITIES).map(async (city) => ({
        key: city.key,
        label: city.label,
        centre: city.centre,
        facilities: await countFacilities(city.key),
      })),
    );
    return reply.send({ total: await countFacilities(), cities });
  });
}
