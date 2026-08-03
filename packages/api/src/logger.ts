import { config } from './config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVEL_ORDER[(config.logLevel as Level) in LEVEL_ORDER ? (config.logLevel as Level) : 'info'];

/**
 * Fastify brings its own pino logger; this one exists for the code paths that
 * run outside a request (ingestion, migrations, embedding builds).
 */
function emit(level: Level, context: unknown, message?: string): void {
  if (LEVEL_ORDER[level] < threshold) return;
  const text = typeof context === 'string' ? context : message ?? '';
  const fields = typeof context === 'string' ? undefined : context;
  const line = `[${new Date().toISOString()}] ${level.toUpperCase().padEnd(5)} ${text}`;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(fields ? `${line} ${JSON.stringify(fields)}\n` : `${line}\n`);
}

export const logger = {
  debug: (context: unknown, message?: string) => emit('debug', context, message),
  info: (context: unknown, message?: string) => emit('info', context, message),
  warn: (context: unknown, message?: string) => emit('warn', context, message),
  error: (context: unknown, message?: string) => emit('error', context, message),
};
