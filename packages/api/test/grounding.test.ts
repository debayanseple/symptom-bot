import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isGrounded } from '../src/llm/synthesis.ts';
import type { RankedFacility } from '@calldoc/shared';

const facility = (name: string): RankedFacility => ({
  id: '1',
  sourceId: 'node/1',
  source: 'osm',
  name,
  type: 'hospital',
  specialtyTags: ['cardiology'],
  lat: 22.5,
  lon: 88.3,
  address: 'Park Street',
  phone: '+913322223333',
  website: null,
  openingHours: '24/7',
  emergency: true,
  description: null,
  lastSyncedAt: new Date(0).toISOString(),
  distanceKm: 2.1,
  score: 0.8,
  reason: 'test',
});

const RETRIEVED = [facility('City General Hospital'), facility('Park Street Clinic')];

describe('isGrounded', () => {
  it('accepts an explanation that only names retrieved facilities', () => {
    assert.equal(
      isGrounded(
        'A cardiologist is the right starting point here. City General Hospital is the closest option and is open around the clock, so it is a practical first call.',
        RETRIEVED,
      ),
      true,
    );
  });

  it('rejects an invented facility name', () => {
    assert.equal(
      isGrounded(
        'You should visit Apollo Gleneagles Hospital, which is well equipped for this.',
        RETRIEVED,
      ),
      false,
    );
  });

  it('rejects diagnostic language', () => {
    assert.equal(
      isGrounded('It sounds like you may have angina, so see a cardiologist soon.', RETRIEVED),
      false,
    );
  });

  it('rejects treatment or medication advice', () => {
    assert.equal(
      isGrounded('You should take 500 mg of paracetamol and then visit City General Hospital.', RETRIEVED),
      false,
    );
  });

  it('rejects invented ratings and review claims', () => {
    assert.equal(
      isGrounded('City General Hospital is the top rated cardiology centre in the area.', RETRIEVED),
      false,
    );
    assert.equal(
      isGrounded('Patients say City General Hospital has short waiting times.', RETRIEVED),
      false,
    );
  });

  it('rejects empty or truncated output', () => {
    assert.equal(isGrounded('', RETRIEVED), false);
    assert.equal(isGrounded('Sure!', RETRIEVED), false);
  });
});
