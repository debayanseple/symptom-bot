import type { BoundingBox } from '@calldoc/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Overpass QL for every healthcare POI in a bounding box.
 *
 * `nwr` covers nodes, ways and relations in one pass; `out center` gives ways
 * and relations a representative point so everything downstream can treat a
 * facility as a single lat/lon.
 */
export function buildHealthcareQuery(bbox: BoundingBox, timeoutSeconds = 180): string {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `
[out:json][timeout:${timeoutSeconds}];
(
  nwr["amenity"="hospital"](${box});
  nwr["amenity"="clinic"](${box});
  nwr["amenity"="doctors"](${box});
  nwr["amenity"="dentist"](${box});
  nwr["healthcare"="hospital"](${box});
  nwr["healthcare"="clinic"](${box});
  nwr["healthcare"="doctor"](${box});
  nwr["healthcare"="centre"](${box});
);
out center tags;
`.trim();
}

/**
 * Public Overpass instances are shared infrastructure and rate-limit hard.
 * This retries with exponential backoff and honours the documented policy:
 * identifying User-Agent, no parallel queries, back off on 429/504.
 */
export async function runOverpassQuery(
  query: string,
  { retries = 3 }: { retries?: number } = {},
): Promise<OverpassElement[]> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) {
      const backoffMs = 5_000 * 2 ** (attempt - 1);
      logger.warn(`Overpass retry ${attempt}/${retries} in ${backoffMs}ms`);
      await sleep(backoffMs);
    }

    try {
      const response = await fetch(config.osm.overpassUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': config.osm.userAgent,
        },
        body: new URLSearchParams({ data: query }),
        // Large city bounding boxes legitimately take minutes.
        signal: AbortSignal.timeout(240_000),
      });

      // 429 = rate limited, 504 = query timed out server-side. Both retryable.
      if (response.status === 429 || response.status === 504) {
        lastError = new Error(`Overpass returned ${response.status}`);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Overpass HTTP ${response.status}: ${await response.text().catch(() => '')}`);
      }

      const body = (await response.json()) as OverpassResponse;
      return body.elements ?? [];
    } catch (error) {
      lastError = error;
      // A malformed query will fail identically every time — don't burn retries.
      if (error instanceof Error && error.message.includes('HTTP 400')) throw error;
    }
  }

  throw new Error(`Overpass query failed after ${retries + 1} attempts: ${String(lastError)}`);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
