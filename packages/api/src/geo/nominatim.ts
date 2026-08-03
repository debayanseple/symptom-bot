import type { Coordinates } from '@calldoc/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Nominatim's usage policy caps clients at 1 request/second and requires a
 * real User-Agent. This module serialises every call through a single promise
 * chain so concurrent requests queue rather than burst — violating the policy
 * gets the whole deployment IP-blocked.
 */
let queue: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const waitMs = config.osm.nominatimMinIntervalMs - (Date.now() - lastCallAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastCallAt = Date.now();
    return fn();
  });
  // Keep the chain alive even if this call rejects.
  queue = run.catch(() => undefined);
  return run;
}

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
}

/** Free-text place name -> coordinates. Returns undefined when nothing matches. */
export async function geocode(
  placeName: string,
  { countryCodes = 'in' }: { countryCodes?: string } = {},
): Promise<(Coordinates & { displayName: string }) | undefined> {
  const trimmed = placeName.trim();
  if (!trimmed) return undefined;

  return schedule(async () => {
    const url = new URL('/search', config.osm.nominatimUrl);
    url.searchParams.set('q', trimmed);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    url.searchParams.set('addressdetails', '0');
    if (countryCodes) url.searchParams.set('countrycodes', countryCodes);

    try {
      const response = await fetch(url, {
        headers: { 'user-agent': config.osm.userAgent, 'accept-language': 'en' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        logger.warn({ status: response.status, placeName }, 'nominatim geocode failed');
        return undefined;
      }

      const results = (await response.json()) as NominatimPlace[];
      const first = results[0];
      if (!first) return undefined;

      return {
        lat: Number(first.lat),
        lon: Number(first.lon),
        displayName: first.display_name,
      };
    } catch (error) {
      logger.warn({ err: String(error), placeName }, 'nominatim geocode error');
      return undefined;
    }
  });
}

/** Coordinates -> human-readable address. Used to fill gaps in OSM tagging. */
export async function reverseGeocode(point: Coordinates): Promise<string | undefined> {
  return schedule(async () => {
    const url = new URL('/reverse', config.osm.nominatimUrl);
    url.searchParams.set('lat', String(point.lat));
    url.searchParams.set('lon', String(point.lon));
    url.searchParams.set('format', 'jsonv2');

    try {
      const response = await fetch(url, {
        headers: { 'user-agent': config.osm.userAgent, 'accept-language': 'en' },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) return undefined;
      const body = (await response.json()) as { display_name?: string };
      return body.display_name;
    } catch (error) {
      logger.warn({ err: String(error) }, 'nominatim reverse geocode error');
      return undefined;
    }
  });
}
