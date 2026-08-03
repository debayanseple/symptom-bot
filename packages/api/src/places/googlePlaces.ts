import { haversineKm } from '@calldoc/shared';
import type { Coordinates, Facility, FacilityType, Specialty } from '@calldoc/shared';
import { SPECIALTY_META } from '@calldoc/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Google Places (New) as a LIVE provider.
 *
 * Deliberately not an ingestion source. Google's terms let you keep a place ID
 * indefinitely but not build a durable local copy of Places content, so unlike
 * the OpenStreetMap path nothing here is written to Postgres or embedded.
 * Results are fetched per request, merged in memory, and dropped.
 *
 * Consequences that the rest of the pipeline has to live with:
 *   - Google results carry no semantic score; there is no stored embedding to
 *     compare against. They rank on structured signals only.
 *   - Every uncached search costs a billed API call, so this is off unless
 *     GOOGLE_PLACES_ENABLED is set.
 *   - Attribution must be shown wherever these results appear.
 */

const SEARCH_TEXT_URL = 'https://places.googleapis.com/v1/places:searchText';

/**
 * Field masks map directly to billing tiers in Places (New): identity and
 * location fields are cheapest, contact details cost more, ratings more again.
 * Ratings are therefore opt-in — they are the difference between comfortably
 * inside the free allowance and burning through it.
 */
const BASE_FIELDS = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.primaryType',
  'places.types',
  'places.businessStatus',
];

const CONTACT_FIELDS = [
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.regularOpeningHours.weekdayDescriptions',
  'places.regularOpeningHours.openNow',
];

const RATING_FIELDS = ['places.rating', 'places.userRatingCount'];

interface GooglePlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  regularOpeningHours?: { weekdayDescriptions?: string[]; openNow?: boolean };
  rating?: number;
  userRatingCount?: number;
}

export interface GoogleFacility extends Facility {
  distanceKm: number;
  rating?: number;
  ratingCount?: number;
  openNow?: boolean;
}

/** Call accounting, so cost is observable without reading the Cloud console. */
export const placesUsage = { searches: 0, cacheHits: 0, errors: 0 };

/**
 * Short-lived response cache. Purely a cost control: it stops a user
 * refining the same query from being billed repeatedly. Kept well inside
 * Google's temporary-caching allowance, and never persisted to disk.
 */
const cache = new Map<string, { at: number; places: GoogleFacility[] }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 200;

function cacheKey(specialty: Specialty, centre: Coordinates, radiusKm: number): string {
  // Round coordinates so nearby users share a cache entry.
  return `${specialty}|${centre.lat.toFixed(2)},${centre.lon.toFixed(2)}|${radiusKm}`;
}

/**
 * Maps our specialty to a natural-language query. Google's own place types are
 * too coarse for this (everything is `doctor` or `hospital`), so the specialty
 * goes in the text query and lets Google's matching do the work.
 */
function queryFor(specialty: Specialty): string {
  switch (specialty) {
    case 'general_practice':
      return 'general physician doctor clinic';
    case 'emergency':
      return 'emergency hospital casualty';
    case 'dentistry':
      return 'dentist dental clinic';
    default:
      return `${SPECIALTY_META[specialty].label} specialist doctor`;
  }
}

/** Google's coarse types mapped onto ours. */
function typeFor(place: GooglePlace): FacilityType {
  const types = new Set([place.primaryType, ...(place.types ?? [])].filter(Boolean) as string[]);
  if (types.has('hospital')) return 'hospital';
  if (types.has('dentist') || types.has('dental_clinic')) return 'dentist';
  if (types.has('pharmacy') || types.has('drugstore')) return 'pharmacy';
  if (types.has('doctor')) return 'doctor';
  return 'clinic';
}

/**
 * Searches Google for facilities matching a specialty near a point.
 *
 * Returns an empty array rather than throwing on any failure — a Google outage,
 * an exhausted quota or a bad key must degrade to the OpenStreetMap results,
 * never break the request.
 */
export async function searchGooglePlaces(
  specialty: Specialty,
  centre: Coordinates,
  radiusKm: number,
): Promise<GoogleFacility[]> {
  if (!config.google.enabled || !config.google.apiKey) return [];

  const key = cacheKey(specialty, centre, radiusKm);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    placesUsage.cacheHits += 1;
    return hit.places;
  }

  const fieldMask = [
    ...BASE_FIELDS,
    ...CONTACT_FIELDS,
    ...(config.google.includeRatings ? RATING_FIELDS : []),
  ].join(',');

  try {
    const response = await fetch(SEARCH_TEXT_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Goog-Api-Key': config.google.apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      signal: AbortSignal.timeout(config.google.timeoutMs),
      body: JSON.stringify({
        textQuery: queryFor(specialty),
        maxResultCount: config.google.maxResults,
        languageCode: 'en',
        locationBias: {
          circle: {
            center: { latitude: centre.lat, longitude: centre.lon },
            // Google caps the bias radius at 50km.
            radius: Math.min(50_000, radiusKm * 1000),
          },
        },
      }),
    });

    placesUsage.searches += 1;

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      placesUsage.errors += 1;
      // 403 is almost always a key restriction or a disabled API; 429 is quota.
      logger.warn(
        { status: response.status, detail: detail.slice(0, 300) },
        'google places search failed — falling back to OpenStreetMap only',
      );
      return [];
    }

    const body = (await response.json()) as { places?: GooglePlace[] };
    const places = (body.places ?? [])
      .filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY')
      .map((p) => toFacility(p, specialty, centre))
      .filter((p): p is GoogleFacility => p !== null);

    if (cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) cache.delete(oldest[0]);
    }
    cache.set(key, { at: Date.now(), places });

    return places;
  } catch (error) {
    placesUsage.errors += 1;
    logger.warn({ err: String(error) }, 'google places unavailable — using OpenStreetMap only');
    return [];
  }
}

function toFacility(
  place: GooglePlace,
  specialty: Specialty,
  centre: Coordinates,
): GoogleFacility | null {
  const name = place.displayName?.text?.trim();
  const lat = place.location?.latitude;
  const lon = place.location?.longitude;
  if (!name || typeof lat !== 'number' || typeof lon !== 'number') return null;

  const type = typeFor(place);
  if (type === 'pharmacy') return null;

  return {
    // Prefixed so a Google result can never collide with a Postgres row id.
    id: `google:${place.id}`,
    sourceId: place.id,
    source: 'google',
    name,
    practitioner: null,
    type,
    // Google returned this for the specialty we asked about; that is the only
    // specialty claim we can make about it.
    specialtyTags: [specialty],
    lat,
    lon,
    address: place.formattedAddress ?? null,
    phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? null,
    website: place.websiteUri ?? null,
    openingHours: place.regularOpeningHours?.weekdayDescriptions?.join('; ') ?? null,
    emergency: (place.types ?? []).includes('emergency_room'),
    description: null,
    lastSyncedAt: new Date().toISOString(),
    distanceKm: haversineKm(centre, { lat, lon }),
    ...(place.rating === undefined ? {} : { rating: place.rating }),
    ...(place.userRatingCount === undefined ? {} : { ratingCount: place.userRatingCount }),
    ...(place.regularOpeningHours?.openNow === undefined
      ? {}
      : { openNow: place.regularOpeningHours.openNow }),
  };
}

/**
 * Drops Google entries that duplicate an OpenStreetMap result.
 *
 * The same clinic is frequently in both datasets under slightly different
 * names. A match requires BOTH proximity and name similarity — proximity alone
 * is not enough, because medical complexes routinely stack several unrelated
 * practices in one building, and dropping those would hide real options from
 * the user. The OSM record wins, because it is the one we can legally keep.
 *
 * The failure mode this accepts is the milder one: the same clinic listed
 * under two very different names appears twice, rather than a distinct clinic
 * silently disappearing.
 */
export function dedupeAgainst<T extends { name: string; lat: number; lon: number }>(
  googleResults: GoogleFacility[],
  existing: T[],
): GoogleFacility[] {
  return googleResults.filter((candidate) => {
    const candidateKey = normaliseName(candidate.name);
    return !existing.some((other) => {
      const metres = haversineKm(candidate, other) * 1000;
      if (metres > 150) return false;
      const otherKey = normaliseName(other.name);
      if (!candidateKey || !otherKey) return false;
      return (
        candidateKey === otherKey ||
        candidateKey.includes(otherKey) ||
        otherKey.includes(candidateKey)
      );
    });
  });
}

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(hospital|clinic|nursing home|centre|center|pvt|ltd|limited|the|and|&)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}
