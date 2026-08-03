import { boundingBoxAround } from '@calldoc/shared';
import type { Coordinates, Facility, FacilityType, Specialty } from '@calldoc/shared';
import { query, withTransaction } from '../db/pool.js';
import type { MappedFacility } from '../ingest/osmMapper.js';

interface FacilityRow {
  id: string;
  source: string;
  source_id: string;
  name: string;
  type: string;
  specialty_tags: string[];
  lat: number;
  lon: number;
  address: string | null;
  phone: string | null;
  website: string | null;
  opening_hours: string | null;
  emergency: boolean;
  description: string | null;
  last_synced_at: Date;
  distance_km: number;
}

export interface NearbyQuery {
  centre: Coordinates;
  radiusKm: number;
  specialty?: Specialty;
  types?: FacilityType[];
  emergencyOnly?: boolean;
  limit?: number;
}

export interface NearbyFacility extends Facility {
  distanceKm: number;
}

/**
 * THE GEO FILTER (PRD section 4, "key design rule").
 *
 * Runs before any vector search. The bounding box lets Postgres use the
 * (lat, lon) btree index to eliminate almost everything, and the exact
 * haversine distance is then computed only on survivors — which is both
 * correct and fast, in a way that vector similarity over "nearest" never is.
 */
export async function findNearby(params: NearbyQuery): Promise<NearbyFacility[]> {
  const { centre, radiusKm, specialty, types, emergencyOnly, limit = 50 } = params;
  const box = boundingBoxAround(centre, radiusKm);

  const conditions = [
    'lat BETWEEN $1 AND $2',
    'lon BETWEEN $3 AND $4',
    // Pharmacies are ingested for completeness but never recommended as a
    // place to see a doctor.
    "type <> 'pharmacy'",
  ];
  const values: unknown[] = [box.south, box.north, box.west, box.east, centre.lat, centre.lon, radiusKm];

  if (specialty) {
    values.push(specialty);
    conditions.push(`specialty_tags && ARRAY[$${values.length}]::text[]`);
  }
  if (types?.length) {
    values.push(types);
    conditions.push(`type = ANY($${values.length}::text[])`);
  }
  if (emergencyOnly) {
    conditions.push('emergency = TRUE');
  }

  values.push(limit);

  const sql = `
    SELECT id, source, source_id, name, type, specialty_tags, lat, lon, address,
           phone, website, opening_hours, emergency, description, last_synced_at,
           haversine_km($5, $6, lat, lon) AS distance_km
    FROM facilities
    WHERE ${conditions.join(' AND ')}
      AND haversine_km($5, $6, lat, lon) <= $7
    ORDER BY distance_km ASC
    LIMIT $${values.length}
  `;

  const { rows } = await query<FacilityRow>(sql, values);
  return rows.map(toFacility);
}

/**
 * Widens the radius until something turns up. Urban OSM coverage is good but
 * uneven — a niche specialty may simply not exist within 8 km.
 */
export async function findNearbyWithExpansion(
  params: NearbyQuery,
  maxRadiusKm: number,
): Promise<{ facilities: NearbyFacility[]; radiusKm: number; expanded: boolean }> {
  let radiusKm = params.radiusKm;
  let facilities = await findNearby({ ...params, radiusKm });
  let expanded = false;

  while (facilities.length === 0 && radiusKm < maxRadiusKm) {
    radiusKm = Math.min(maxRadiusKm, radiusKm * 2);
    expanded = true;
    facilities = await findNearby({ ...params, radiusKm });
  }

  return { facilities, radiusKm, expanded };
}

/** Nearest facilities with an emergency department. Used by the triage layer. */
export async function findNearestEmergency(
  centre: Coordinates,
  limit = 3,
): Promise<NearbyFacility[]> {
  // Emergency departments are sparse, so this searches wide from the outset.
  return findNearby({
    centre,
    radiusKm: 25,
    emergencyOnly: true,
    limit,
  });
}

export async function getFacilityById(id: string): Promise<NearbyFacility | undefined> {
  const { rows } = await query<FacilityRow>(
    `SELECT *, 0::double precision AS distance_km FROM facilities WHERE id = $1`,
    [id],
  );
  return rows[0] ? toFacility(rows[0]) : undefined;
}

/**
 * Upserts a batch from an ingestion run. Conflict target is (source, source_id)
 * so re-running the nightly job updates in place instead of duplicating.
 */
export async function upsertFacilities(
  facilities: MappedFacility[],
  cityKey: string,
): Promise<number> {
  if (facilities.length === 0) return 0;

  return withTransaction(async (client) => {
    let upserted = 0;
    // Chunked rather than one giant statement — Postgres caps bind parameters
    // at 65535 and a city can return thousands of facilities.
    const CHUNK = 200;

    for (let i = 0; i < facilities.length; i += CHUNK) {
      const chunk = facilities.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((facility, index) => {
        const base = index * 15;
        values.push(
          facility.source,
          facility.sourceId,
          facility.name,
          facility.type,
          facility.specialtyTags,
          facility.lat,
          facility.lon,
          facility.address,
          facility.phone,
          facility.website,
          facility.openingHours,
          facility.emergency,
          facility.description,
          cityKey,
          JSON.stringify(facility.rawTags),
        );
        const p = (offset: number) => `$${base + offset}`;
        return `(${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}::text[], ${p(6)}, ${p(7)}, ${p(8)}, ${p(9)}, ${p(10)}, ${p(11)}, ${p(12)}, ${p(13)}, ${p(14)}, ${p(15)}::jsonb)`;
      });

      const result = await client.query(
        `
        INSERT INTO facilities (
          source, source_id, name, type, specialty_tags, lat, lon, address,
          phone, website, opening_hours, emergency, description, city_key, raw_tags
        ) VALUES ${tuples.join(', ')}
        ON CONFLICT (source, source_id) DO UPDATE SET
          name           = EXCLUDED.name,
          type           = EXCLUDED.type,
          specialty_tags = EXCLUDED.specialty_tags,
          lat            = EXCLUDED.lat,
          lon            = EXCLUDED.lon,
          address        = COALESCE(EXCLUDED.address, facilities.address),
          phone          = COALESCE(EXCLUDED.phone, facilities.phone),
          website        = COALESCE(EXCLUDED.website, facilities.website),
          opening_hours  = COALESCE(EXCLUDED.opening_hours, facilities.opening_hours),
          emergency      = EXCLUDED.emergency,
          description    = EXCLUDED.description,
          city_key       = EXCLUDED.city_key,
          raw_tags       = EXCLUDED.raw_tags,
          last_synced_at = now()
        `,
        values,
      );
      upserted += result.rowCount ?? 0;
    }

    return upserted;
  });
}

export async function countFacilities(cityKey?: string): Promise<number> {
  const { rows } = await query<{ count: number }>(
    cityKey
      ? 'SELECT count(*)::int AS count FROM facilities WHERE city_key = $1'
      : 'SELECT count(*)::int AS count FROM facilities',
    cityKey ? [cityKey] : [],
  );
  return rows[0]?.count ?? 0;
}

function toFacility(row: FacilityRow): NearbyFacility {
  return {
    id: String(row.id),
    source: row.source as Facility['source'],
    sourceId: row.source_id,
    name: row.name,
    type: row.type as FacilityType,
    specialtyTags: row.specialty_tags as Specialty[],
    lat: row.lat,
    lon: row.lon,
    address: row.address,
    phone: row.phone,
    website: row.website,
    openingHours: row.opening_hours,
    emergency: row.emergency,
    description: row.description,
    lastSyncedAt: new Date(row.last_synced_at).toISOString(),
    distanceKm: Number(row.distance_km),
  };
}
