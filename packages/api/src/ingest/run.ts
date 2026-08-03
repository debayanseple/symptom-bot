import { config } from '../config.js';
import { closePool, query } from '../db/pool.js';
import { logger } from '../logger.js';
import { upsertFacilities } from '../geo/facilityRepo.js';
import { buildHealthcareQuery, runOverpassQuery } from '../geo/overpass.js';
import { getCity } from './cities.js';
import { mapOverpassElement } from './osmMapper.js';
import type { MappedFacility } from './osmMapper.js';

export interface IngestResult {
  cityKey: string;
  elementsReturned: number;
  mapped: number;
  upserted: number;
}

/**
 * Nightly/weekly batch ingestion (PRD section 6). Deliberately batch, not
 * per-query: Overpass has a usage policy and hammering it per user request
 * would get the deployment blocked, and OSM data changes on the order of days.
 */
export async function ingestCity(cityKey: string): Promise<IngestResult> {
  const city = getCity(cityKey);
  logger.info(`ingesting ${city.label} (${JSON.stringify(city.bbox)})`);

  const runId = await startRun(city.key);

  try {
    const elements = await runOverpassQuery(buildHealthcareQuery(city.bbox));
    logger.info(`Overpass returned ${elements.length} elements`);

    const seen = new Set<string>();
    const mapped: MappedFacility[] = [];

    for (const element of elements) {
      const facility = mapOverpassElement(element);
      if (!facility) continue;
      // Hospitals are frequently mapped as both a node and an enclosing way.
      // Dedupe on name+rounded position so the user sees one entry, not two.
      const dedupeKey = `${facility.name.toLowerCase()}@${facility.lat.toFixed(4)},${facility.lon.toFixed(4)}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      mapped.push(facility);
      if (mapped.length >= config.ingest.maxFacilities) {
        logger.warn(`hit INGEST_MAX_FACILITIES (${config.ingest.maxFacilities}), truncating`);
        break;
      }
    }

    logger.info(
      `mapped ${mapped.length} usable facilities (dropped ${elements.length - mapped.length} unnamed/untyped/duplicate)`,
    );

    const upserted = await upsertFacilities(mapped, city.key);
    await finishRun(runId, 'success', elements.length, upserted);

    logger.info(`upserted ${upserted} facilities for ${city.label}`);
    return {
      cityKey: city.key,
      elementsReturned: elements.length,
      mapped: mapped.length,
      upserted,
    };
  } catch (error) {
    await finishRun(runId, 'failed', 0, 0, String(error));
    throw error;
  }
}

async function startRun(cityKey: string): Promise<string> {
  const { rows } = await query<{ id: string }>(
    `INSERT INTO ingest_runs (city_key, source) VALUES ($1, 'osm') RETURNING id`,
    [cityKey],
  );
  return rows[0]!.id;
}

async function finishRun(
  id: string,
  status: 'success' | 'failed',
  seen: number,
  upserted: number,
  error?: string,
): Promise<void> {
  await query(
    `UPDATE ingest_runs
        SET finished_at = now(), status = $2, facilities_seen = $3,
            facilities_upserted = $4, error = $5
      WHERE id = $1`,
    [id, status, seen, upserted, error ?? null],
  );
}

// `npm run ingest -- kolkata` or INGEST_CITY=kolkata npm run ingest
if (process.argv[1]?.endsWith('run.ts') || process.argv[1]?.endsWith('run.js')) {
  const target = process.argv[2] ?? config.ingest.city;

  ingestCity(target)
    .then(async (result) => {
      logger.info(result, 'ingestion complete');
      logger.info('next: `npm run embed` to build the RAG vectors');
      await closePool();
    })
    .catch(async (error) => {
      logger.error({ err: String(error) }, 'ingestion failed');
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
