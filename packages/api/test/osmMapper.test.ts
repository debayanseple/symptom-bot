import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractPractitioner, mapOverpassElement } from '../src/ingest/osmMapper.ts';
import type { OverpassElement } from '../src/geo/overpass.ts';

const node = (tags: Record<string, string>, overrides: Partial<OverpassElement> = {}): OverpassElement => ({
  type: 'node',
  id: 1,
  lat: 22.5726,
  lon: 88.3639,
  tags,
  ...overrides,
});

describe('mapOverpassElement', () => {
  it('maps a tagged hospital', () => {
    const result = mapOverpassElement(
      node({
        name: 'City General Hospital',
        amenity: 'hospital',
        emergency: 'yes',
        'healthcare:speciality': 'cardiology;orthopaedics',
        'addr:street': 'Park Street',
        'addr:city': 'Kolkata',
        phone: '+91 33 2222 3333',
        opening_hours: '24/7',
      }),
    );

    assert.ok(result);
    assert.equal(result.type, 'hospital');
    assert.equal(result.emergency, true);
    assert.deepEqual(result.specialtyTags.sort(), ['cardiology', 'emergency', 'orthopaedics']);
    assert.equal(result.phone, '+913322223333');
    assert.match(result.address ?? '', /Park Street/);
    assert.match(result.description, /emergency department/i);
  });

  it('drops unnamed elements', () => {
    assert.equal(mapOverpassElement(node({ amenity: 'clinic' })), null);
  });

  it('drops elements with no usable healthcare tag', () => {
    assert.equal(mapOverpassElement(node({ name: 'Corner Cafe', amenity: 'cafe' })), null);
  });

  it('drops elements with no coordinates', () => {
    assert.equal(
      mapOverpassElement({ type: 'way', id: 2, tags: { name: 'X', amenity: 'clinic' } }),
      null,
    );
  });

  it('uses the centre point for ways and relations', () => {
    const result = mapOverpassElement({
      type: 'way',
      id: 3,
      center: { lat: 22.6, lon: 88.4 },
      tags: { name: 'Ward Clinic', amenity: 'clinic' },
    });
    assert.equal(result?.lat, 22.6);
    assert.equal(result?.lon, 88.4);
  });

  it('defaults untagged clinics to general practice so they stay findable', () => {
    const result = mapOverpassElement(node({ name: 'Lane Clinic', amenity: 'clinic' }));
    assert.deepEqual(result?.specialtyTags, ['general_practice']);
  });

  it('always tags dentists with dentistry', () => {
    const result = mapOverpassElement(node({ name: 'Smile Dental', amenity: 'dentist' }));
    assert.equal(result?.type, 'dentist');
    assert.deepEqual(result?.specialtyTags, ['dentistry']);
  });

  it('accepts the misspelled healthcare:specialty key', () => {
    const result = mapOverpassElement(
      node({ name: 'Skin Care', amenity: 'doctors', 'healthcare:specialty': 'dermatology' }),
    );
    assert.ok(result?.specialtyTags.includes('dermatology'));
  });

  it('ignores unmappable specialty tokens rather than guessing', () => {
    const result = mapOverpassElement(
      node({ name: 'Mystery Clinic', amenity: 'clinic', 'healthcare:speciality': 'quantum_healing' }),
    );
    assert.deepEqual(result?.specialtyTags, ['general_practice']);
  });

  it('keeps only the first phone number and rejects junk', () => {
    assert.equal(
      mapOverpassElement(node({ name: 'A', amenity: 'clinic', phone: '033-4444-5555;033-6666-7777' }))?.phone,
      '03344445555',
    );
    assert.equal(
      mapOverpassElement(node({ name: 'B', amenity: 'clinic', phone: '123' }))?.phone,
      null,
    );
  });

  it('extracts the practitioner when a practice is named after a doctor', () => {
    const result = mapOverpassElement(
      node({ name: 'Dr. D.S.Chopra', amenity: 'doctors' }),
    );
    assert.equal(result?.practitioner, 'Dr. D.S.Chopra');
  });

  it('leaves practitioner null for ordinary facility names', () => {
    assert.equal(
      mapOverpassElement(node({ name: 'Ruby General Hospital', amenity: 'hospital' }))?.practitioner,
      null,
    );
  });

  it('falls back to the operator tag for the practitioner', () => {
    const result = mapOverpassElement(
      node({ name: 'City Polyclinic', amenity: 'clinic', operator: 'Dr Pinaki Mazumder' }),
    );
    assert.equal(result?.practitioner, 'Dr. Pinaki Mazumder');
  });
});

describe('extractPractitioner', () => {
  // Every case here is a real name from the Kolkata OpenStreetMap extract.
  const CASES: [input: string, expected: string | null][] = [
    ['Dr. D.S.Chopra', 'Dr. D.S.Chopra'],
    ['Dr. Syamal Kumar Pandey', 'Dr. Syamal Kumar Pandey'],
    ["Dr Paul's Clinic", 'Dr. Paul'],
    ['Seva Ckinic-Dr. M Rahaman', 'Dr. M Rahaman'],
    ['Dr. B.N.Bose Sub-divisional Hospital', 'Dr. B.N.Bose'],
    ['Dr Nihar Munshi Eye Foundation', 'Dr. Nihar Munshi'],
    ['Dr. M. N. Chatterjee Memorial Eye Hospital', 'Dr. M. N. Chatterjee'],
    ['Dr Rafi Ahmed Dental College & Hospital', 'Dr. Rafi Ahmed'],
    ['Dr. B. C. Roy Post Graduate Institute', 'Dr. B. C. Roy'],
    // Not people.
    ['Ruby General Hospital', null],
    ['Dental Exotica', null],
    ['drug store', null],
    ["Children's Hospital", null],
    ['', null],
  ];

  for (const [input, expected] of CASES) {
    it(`"${input || '(empty)'}" -> ${expected ?? 'null'}`, () => {
      assert.equal(extractPractitioner(input), expected);
    });
  }
});

describe('mapOverpassElement — misc', () => {
  it('builds a stable source id per OSM element', () => {
    const result = mapOverpassElement(node({ name: 'A', amenity: 'clinic' }, { id: 987 }));
    assert.equal(result?.sourceId, 'node/987');
  });
});
