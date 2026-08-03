import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FastifyInstance } from 'fastify';

// These routes are the ones that must work with no database, no Ollama and no
// embedding model — i.e. the parts of the system that can never be down.
process.env.LLM_ENABLED = 'false';

// Force an unreachable database. Set before the config module is imported, and
// dotenv does not override an existing process.env value, so this wins over
// whatever DATABASE_URL is in .env. Without it these tests would pass or fail
// depending on whether the developer happens to have a database configured —
// the DB-outage assertions below would silently stop testing anything.
process.env.DATABASE_URL = 'postgres://unused:unused@127.0.0.1:1/unreachable';

const { buildServer } = await import('../src/index.ts');

describe('server (no external dependencies)', () => {
  let app: FastifyInstance;

  before(async () => {
    app = await buildServer();
    await app.ready();
  });

  after(async () => {
    await app.close();
  });

  it('serves a liveness check', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: 'ok' });
  });

  it('runs triage without touching the database', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/triage',
      payload: { message: 'crushing chest pain and my left arm hurts' },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { isEmergency: boolean; matches: { ruleId: string }[] };
    assert.equal(body.isEmergency, true);
    assert.ok(body.matches.some((m) => m.ruleId === 'cardiac.chest_pain'));
  });

  it('asks for a location before searching', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { message: 'itchy rash on my arm for a week' },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { kind: string; needs: string[] };
    assert.equal(body.kind, 'clarification');
    assert.deepEqual(body.needs, ['location']);
  });

  it('rejects out-of-range coordinates', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { message: 'sore throat', location: { lat: 999, lon: 0 } },
    });
    assert.equal(response.statusCode, 400);
    assert.equal((response.json() as { error: string }).error, 'invalid_request');
  });

  it('never leaks internal error details on a 500', async () => {
    // No database is running in the test environment, so this genuinely fails
    // inside the geo-filter — exactly the case the handler exists for.
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: { message: 'itchy rash on my arm', location: { lat: 22.5726, lon: 88.3639 } },
    });

    assert.equal(response.statusCode, 500);
    const body = response.json() as { error: string; message: string };
    assert.equal(body.error, 'internal_error');
    assert.ok(!/ECONNREFUSED|postgres|password/i.test(JSON.stringify(body)));
  });

  it('still raises the emergency warning when the database is unreachable', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        message: 'my father passed out and is unresponsive',
        location: { lat: 22.5726, lon: 88.3639 },
      },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json() as { kind: string; emergencyNumbers: unknown[] };
    assert.equal(body.kind, 'emergency');
    assert.ok(body.emergencyNumbers.length > 0);
  });
});
