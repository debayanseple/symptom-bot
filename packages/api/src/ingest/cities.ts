import type { BoundingBox, Coordinates } from '@calldoc/shared';

export interface CityConfig {
  key: string;
  label: string;
  country: string;
  centre: Coordinates;
  /** Ingestion bounding box. Keep it to the built-up urban area — MVP scope is
   *  cities only, where OSM healthcare tagging is dense enough to be usable. */
  bbox: BoundingBox;
}

/**
 * Launch city first, others staged behind it. Adding a city is a config change
 * plus one ingestion run — no code change.
 */
export const CITIES: Record<string, CityConfig> = {
  kolkata: {
    key: 'kolkata',
    label: 'Kolkata',
    country: 'India',
    centre: { lat: 22.5726, lon: 88.3639 },
    // Greater Kolkata: KMC plus Salt Lake, New Town, Howrah, Behala, Barrackpore
    // and Sonarpur. Measured against a tighter KMC-only box, this wider extent
    // returns ~24% more facilities (736 vs 592 elements), so the outer suburbs
    // are worth the extra Overpass time.
    bbox: { south: 22.35, west: 88.15, north: 22.85, east: 88.62 },
  },
  bengaluru: {
    key: 'bengaluru',
    label: 'Bengaluru',
    country: 'India',
    centre: { lat: 12.9716, lon: 77.5946 },
    bbox: { south: 12.83, west: 77.45, north: 13.14, east: 77.78 },
  },
  delhi: {
    key: 'delhi',
    label: 'Delhi NCR',
    country: 'India',
    centre: { lat: 28.6139, lon: 77.209 },
    bbox: { south: 28.4, west: 76.95, north: 28.88, east: 77.42 },
  },
  mumbai: {
    key: 'mumbai',
    label: 'Mumbai',
    country: 'India',
    centre: { lat: 19.076, lon: 72.8777 },
    bbox: { south: 18.89, west: 72.77, north: 19.28, east: 72.99 },
  },
  hyderabad: {
    key: 'hyderabad',
    label: 'Hyderabad',
    country: 'India',
    centre: { lat: 17.385, lon: 78.4867 },
    bbox: { south: 17.26, west: 78.31, north: 17.55, east: 78.63 },
  },
};

export function getCity(key: string): CityConfig {
  const city = CITIES[key.toLowerCase()];
  if (!city) {
    throw new Error(
      `Unknown city "${key}". Known cities: ${Object.keys(CITIES).join(', ')}. Add one in packages/api/src/ingest/cities.ts`,
    );
  }
  return city;
}

/** The city whose bbox contains this point, if any. */
export function cityForPoint(point: Coordinates): CityConfig | undefined {
  return Object.values(CITIES).find(
    (city) =>
      point.lat >= city.bbox.south &&
      point.lat <= city.bbox.north &&
      point.lon >= city.bbox.west &&
      point.lon <= city.bbox.east,
  );
}
