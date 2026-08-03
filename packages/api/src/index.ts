import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify from 'fastify';
import { assertProductionConfig, config } from './config.js';
import { closePool } from './db/pool.js';
import { chatRoutes } from './routes/chat.js';
import { facilityRoutes } from './routes/facilities.js';
import { healthRoutes } from './routes/health.js';

export async function buildServer() {
  const app = Fastify({
    logger: { level: config.logLevel },
    // Free-tier hosts sit behind a proxy; without this every client shares one
    // rate-limit bucket.
    trustProxy: true,
  });

  await app.register(cors, {
    origin: config.corsOrigin.split(',').map((o) => o.trim()),
  });

  await app.register(rateLimit, {
    max: 30,
    timeWindow: '1 minute',
    // Ollama inference is the bottleneck; this keeps one client from
    // monopolising a single-process CPU-bound model.
    errorResponseBuilder: () => ({
      error: 'rate_limited',
      message: 'Too many requests. Please wait a moment and try again.',
    }),
  });

  // Must be set BEFORE the route plugins are registered: awaiting `register`
  // boots the encapsulated child context immediately, and a child captures the
  // parent's error handler at boot time. Setting it afterwards would leave the
  // routes on Fastify's default handler, which serialises the raw error.
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    request.log.error({ err: error }, 'unhandled request error');
    // Never leak internals to a user who is mid-symptom-description.
    const status = error.statusCode ?? 500;
    reply.status(status).send(
      status >= 500
        ? { error: 'internal_error', message: 'Something went wrong on our side. Please try again.' }
        : { error: 'request_error', message: error.message },
    );
  });

  await app.register(healthRoutes);
  await app.register(chatRoutes);
  await app.register(facilityRoutes);

  return app;
}

async function start(): Promise<void> {
  assertProductionConfig();
  const app = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    await closePool();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

// Only auto-start when run as the entrypoint, so tests can import buildServer.
if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  start().catch((error) => {
    console.error('failed to start server:', error);
    process.exit(1);
  });
}
