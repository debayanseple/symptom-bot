import type { BoundingBox, Coordinates } from './types.js';

const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function haversineKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Bounding box around a point. Used as a cheap index-friendly prefilter before
 * the exact haversine distance is computed in SQL.
 */
export function boundingBoxAround(centre: Coordinates, radiusKm: number): BoundingBox {
  const latDelta = radiusKm / 111.32;
  // Longitude degrees shrink towards the poles. Clamp the cosine so a point at
  // an extreme latitude cannot produce an infinite delta.
  const lonDelta = radiusKm / (111.32 * Math.max(0.01, Math.cos(toRad(centre.lat))));
  return {
    south: centre.lat - latDelta,
    north: centre.lat + latDelta,
    west: centre.lon - lonDelta,
    east: centre.lon + lonDelta,
  };
}

export function isValidCoordinates(value: unknown): value is Coordinates {
  if (typeof value !== 'object' || value === null) return false;
  const { lat, lon } = value as Partial<Coordinates>;
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}
