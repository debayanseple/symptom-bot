import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dedupeAgainst, searchGooglePlaces } from '../src/places/googlePlaces.ts';
import type { GoogleFacility } from '../src/places/googlePlaces.ts';

const google = (name: string, lat: number, lon: number): GoogleFacility => ({
  id: `google:${name}`,
  sourceId: name,
  source: 'google',
  name,
  practitioner: null,
  type: 'clinic',
  specialtyTags: ['dentistry'],
  lat,
  lon,
  address: null,
  phone: '+913312345678',
  website: null,
  openingHours: null,
  emergency: false,
  description: null,
  lastSyncedAt: new Date(0).toISOString(),
  distanceKm: 1,
});

describe('dedupeAgainst', () => {
  const osm = [{ name: 'Dental Exotica', lat: 22.5377, lon: 88.3665 }];

  it('drops a Google result that is the same place as an OSM one', () => {
    const result = dedupeAgainst([google('Dental Exotica', 22.5377, 88.3665)], osm);
    assert.equal(result.length, 0);
  });

  it('drops near-identical names within the positional threshold', () => {
    // ~30 m away, name differs by a suffix the normaliser strips.
    const result = dedupeAgainst([google('Dental Exotica Clinic', 22.5379, 88.3665)], osm);
    assert.equal(result.length, 0);
  });

  it('keeps a genuinely different clinic at the same address', () => {
    const result = dedupeAgainst([google('Smile Studio', 22.5377, 88.3665)], osm);
    assert.equal(result.length, 1);
  });

  it('keeps the same name far away — different branch, not a duplicate', () => {
    const result = dedupeAgainst([google('Dental Exotica', 22.58, 88.40)], osm);
    assert.equal(result.length, 1);
  });

  it('keeps everything when there is nothing to compare against', () => {
    assert.equal(dedupeAgainst([google('Anything', 22.5, 88.3)], []).length, 1);
  });
});

describe('searchGooglePlaces', () => {
  it('returns nothing and costs nothing when disabled', async () => {
    // GOOGLE_PLACES_ENABLED defaults to false, so this must not attempt a call.
    const result = await searchGooglePlaces('dentistry', { lat: 22.55, lon: 88.35 }, 8);
    assert.deepEqual(result, []);
  });
});
