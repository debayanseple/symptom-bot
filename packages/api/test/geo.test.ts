import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { boundingBoxAround, haversineKm, isValidCoordinates } from '@calldoc/shared';

describe('haversineKm', () => {
  it('is zero for identical points', () => {
    assert.equal(haversineKm({ lat: 22.5726, lon: 88.3639 }, { lat: 22.5726, lon: 88.3639 }), 0);
  });

  it('matches a known distance (Kolkata to Delhi, ~1305 km)', () => {
    const distance = haversineKm({ lat: 22.5726, lon: 88.3639 }, { lat: 28.6139, lon: 77.209 });
    assert.ok(Math.abs(distance - 1305) < 15, `got ${distance}`);
  });

  it('is symmetric', () => {
    const a = { lat: 22.5726, lon: 88.3639 };
    const b = { lat: 22.6, lon: 88.4 };
    assert.equal(haversineKm(a, b).toFixed(6), haversineKm(b, a).toFixed(6));
  });
});

describe('boundingBoxAround', () => {
  it('contains every point inside the radius', () => {
    const centre = { lat: 22.5726, lon: 88.3639 };
    const box = boundingBoxAround(centre, 5);

    // Sample the circle; every point at exactly the radius must fall inside.
    for (let bearing = 0; bearing < 360; bearing += 15) {
      const rad = (bearing * Math.PI) / 180;
      const point = {
        lat: centre.lat + (5 / 111.32) * Math.cos(rad),
        lon: centre.lon + (5 / (111.32 * Math.cos((centre.lat * Math.PI) / 180))) * Math.sin(rad),
      };
      assert.ok(point.lat >= box.south && point.lat <= box.north, `lat out of box at ${bearing}°`);
      assert.ok(point.lon >= box.west && point.lon <= box.east, `lon out of box at ${bearing}°`);
    }
  });

  it('does not blow up near the poles', () => {
    const box = boundingBoxAround({ lat: 89.999, lon: 0 }, 10);
    assert.ok(Number.isFinite(box.east) && Number.isFinite(box.west));
  });
});

describe('isValidCoordinates', () => {
  it('accepts valid points', () => {
    assert.equal(isValidCoordinates({ lat: 22.5, lon: 88.3 }), true);
  });

  it('rejects out-of-range, missing and non-numeric values', () => {
    assert.equal(isValidCoordinates({ lat: 91, lon: 0 }), false);
    assert.equal(isValidCoordinates({ lat: 0, lon: 181 }), false);
    assert.equal(isValidCoordinates({ lat: 0 }), false);
    assert.equal(isValidCoordinates({ lat: '22.5', lon: '88.3' }), false);
    assert.equal(isValidCoordinates(null), false);
    assert.equal(isValidCoordinates({ lat: NaN, lon: 0 }), false);
  });
});
