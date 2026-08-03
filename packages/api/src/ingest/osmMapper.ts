import { OSM_SPECIALITY_INDEX, isSpecialty } from '@calldoc/shared';
import type { FacilityType, Specialty } from '@calldoc/shared';
import type { OverpassElement } from '../geo/overpass.js';

export interface MappedFacility {
  source: 'osm';
  sourceId: string;
  name: string;
  type: FacilityType;
  specialtyTags: Specialty[];
  lat: number;
  lon: number;
  address: string | null;
  phone: string | null;
  website: string | null;
  openingHours: string | null;
  emergency: boolean;
  description: string;
  rawTags: Record<string, string>;
}

/**
 * OSM tagging is inconsistent in exactly the ways you would expect from
 * crowd-sourced data: `amenity=doctors` vs `healthcare=doctor`, specialities
 * semicolon-joined in one of two differently-spelled keys, phone numbers under
 * three different tags. This function absorbs that so nothing downstream has
 * to think about it.
 */
export function mapOverpassElement(element: OverpassElement): MappedFacility | null {
  const tags = element.tags ?? {};

  const lat = element.lat ?? element.center?.lat;
  const lon = element.lon ?? element.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number') return null;

  // An unnamed POI is useless to a user who has to phone it. Drop it.
  const name = tags['name:en'] ?? tags['name'] ?? tags['operator'];
  if (!name?.trim()) return null;

  const type = resolveType(tags);
  if (!type) return null;

  return {
    source: 'osm',
    sourceId: `${element.type}/${element.id}`,
    name: name.trim(),
    type,
    specialtyTags: resolveSpecialties(tags, type),
    lat,
    lon,
    address: composeAddress(tags),
    // `contact:mobile` is the second most common phone key in Indian OSM data
    // after `contact:phone`, and was previously being dropped.
    phone: normalisePhone(
      tags['phone'] ??
        tags['contact:phone'] ??
        tags['phone:mobile'] ??
        tags['contact:mobile'] ??
        tags['mobile'],
    ),
    website: tags['website'] ?? tags['contact:website'] ?? tags['url'] ?? null,
    openingHours: tags['opening_hours'] ?? null,
    emergency: tags['emergency'] === 'yes' || tags['healthcare:emergency'] === 'yes',
    description: composeDescription(name.trim(), type, tags),
    rawTags: tags,
  };
}

function resolveType(tags: Record<string, string>): FacilityType | null {
  const amenity = tags['amenity'];
  const healthcare = tags['healthcare'];

  if (amenity === 'hospital' || healthcare === 'hospital') return 'hospital';
  if (amenity === 'dentist' || healthcare === 'dentist') return 'dentist';
  if (amenity === 'clinic' || healthcare === 'clinic' || healthcare === 'centre') return 'clinic';
  if (amenity === 'doctors' || healthcare === 'doctor') return 'doctor';
  if (amenity === 'pharmacy' || healthcare === 'pharmacy') return 'pharmacy';
  return null;
}

/**
 * Speciality tags live in `healthcare:speciality` (correct) and
 * `healthcare:specialty` (common misspelling), semicolon-separated. Anything
 * unmapped is discarded rather than guessed at — a wrong specialty tag sends a
 * patient to the wrong doctor.
 */
function resolveSpecialties(tags: Record<string, string>, type: FacilityType): Specialty[] {
  const raw = [tags['healthcare:speciality'], tags['healthcare:specialty'], tags['speciality']]
    .filter(Boolean)
    .join(';');

  const found = new Set<Specialty>();

  for (const token of raw.split(';')) {
    const key = token.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) continue;

    const mapped = OSM_SPECIALITY_INDEX.get(key);
    if (mapped) {
      found.add(mapped);
      continue;
    }
    // Some regions tag the specialty name directly in our own vocabulary.
    if (isSpecialty(key)) found.add(key);
  }

  // Type-implied specialties. A dentist is a dentist whether or not anyone
  // tagged it, and a hospital with an A&E covers emergency by definition.
  if (type === 'dentist') found.add('dentistry');
  if (tags['emergency'] === 'yes') found.add('emergency');

  // Hospitals without speciality tags still handle general presentations, and
  // an untagged clinic/doctor is overwhelmingly a GP practice. Without this,
  // the majority of real OSM records would be unreachable by any query.
  if (found.size === 0 && (type === 'hospital' || type === 'clinic' || type === 'doctor')) {
    found.add('general_practice');
  }

  return [...found];
}

function composeAddress(tags: Record<string, string>): string | null {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:suburb'],
    tags['addr:city'] ?? tags['addr:town'],
    tags['addr:state'],
    tags['addr:postcode'],
  ].filter((part) => part && part.trim());

  if (parts.length > 0) return parts.join(', ');
  // Fall back to whatever free-text address the mapper left behind.
  return tags['address'] ?? tags['addr:full'] ?? null;
}

/**
 * Normalises to a dialable string. OSM phone tags carry every separator style
 * imaginable and sometimes several numbers in one field — we keep the first.
 */
function normalisePhone(value: string | undefined): string | null {
  if (!value) return null;
  const first = value.split(/[;,]/)[0]?.trim();
  if (!first) return null;
  // Keep a leading + (country code) and drop every other non-digit.
  const cleaned = (first.startsWith('+') ? '+' : '') + first.replace(/\D/g, '');
  // Anything shorter than this is a truncated or malformed tag.
  return cleaned.replace(/\D/g, '').length >= 8 ? cleaned : null;
}

/**
 * The text that gets embedded for the RAG layer. Concatenating the descriptive
 * tags gives the embedder something meaningful to work with — raw OSM records
 * have no prose, so this synthesises it.
 */
function composeDescription(
  name: string,
  type: FacilityType,
  tags: Record<string, string>,
): string {
  const bits: string[] = [name, typeLabel(type)];

  const specialities = [tags['healthcare:speciality'], tags['healthcare:specialty']]
    .filter(Boolean)
    .join(';')
    .split(';')
    .map((s) => s.trim().replace(/_/g, ' '))
    .filter(Boolean);
  if (specialities.length) bits.push(`Specialities: ${specialities.join(', ')}.`);

  if (tags['description']) bits.push(tags['description']);
  if (tags['emergency'] === 'yes') bits.push('Has an emergency department open for walk-ins.');
  if (tags['operator']) bits.push(`Operated by ${tags['operator']}.`);
  if (tags['operator:type'] === 'government' || tags['operator:type'] === 'public') {
    bits.push('Government/public facility.');
  }
  if (tags['operator:type'] === 'private') bits.push('Private facility.');
  if (tags['wheelchair'] === 'yes') bits.push('Wheelchair accessible.');
  if (tags['opening_hours'] === '24/7') bits.push('Open 24 hours, every day.');
  else if (tags['opening_hours']) bits.push(`Opening hours: ${tags['opening_hours']}.`);
  if (tags['addr:suburb'] || tags['addr:city']) {
    bits.push(`Located in ${[tags['addr:suburb'], tags['addr:city']].filter(Boolean).join(', ')}.`);
  }

  return bits.join(' ');
}

function typeLabel(type: FacilityType): string {
  switch (type) {
    case 'hospital':
      return 'is a hospital.';
    case 'clinic':
      return 'is a medical clinic.';
    case 'doctor':
      return "is a doctor's practice.";
    case 'dentist':
      return 'is a dental practice.';
    case 'pharmacy':
      return 'is a pharmacy.';
  }
}
