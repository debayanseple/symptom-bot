import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// .env lives at the repo root so every workspace reads the same file.
const here = path.dirname(fileURLToPath(import.meta.url));
loadDotenv({ path: path.resolve(here, '../../../.env') });

const str = (key: string, fallback: string): string => process.env[key] ?? fallback;

const num = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Env var ${key} must be a number, got "${raw}"`);
  }
  return parsed;
};

const bool = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
};

export const config = {
  env: str('NODE_ENV', 'development'),
  port: num('PORT', 3001),
  logLevel: str('LOG_LEVEL', 'info'),
  corsOrigin: str('CORS_ORIGIN', 'http://localhost:5173'),

  databaseUrl: str('DATABASE_URL', 'postgres://calldoc:calldoc@localhost:5432/calldoc'),

  llm: {
    enabled: bool('LLM_ENABLED', true),
    baseUrl: str('OLLAMA_BASE_URL', 'http://localhost:11434'),
    model: str('OLLAMA_MODEL', 'llama3.1:8b'),
    timeoutMs: num('OLLAMA_TIMEOUT_MS', 30_000),
  },

  osm: {
    // Overpass and Nominatim both block requests without an identifying UA.
    userAgent: str('OSM_USER_AGENT', 'CallDoc/0.1 (contact: unset@example.com)'),
    overpassUrl: str('OVERPASS_URL', 'https://overpass-api.de/api/interpreter'),
    nominatimUrl: str('NOMINATIM_URL', 'https://nominatim.openstreetmap.org'),
    nominatimMinIntervalMs: num('NOMINATIM_MIN_INTERVAL_MS', 1100),
  },

  ingest: {
    city: str('INGEST_CITY', 'kolkata'),
    maxFacilities: num('INGEST_MAX_FACILITIES', 5000),
  },

  rag: {
    enabled: bool('RAG_ENABLED', true),
    model: str('EMBEDDING_MODEL', 'Xenova/all-MiniLM-L6-v2'),
    // Must match the vector(N) column width in migration 001.
    dim: num('EMBEDDING_DIM', 384),
  },

  search: {
    defaultRadiusKm: num('DEFAULT_RADIUS_KM', 8),
    maxRadiusKm: num('MAX_RADIUS_KM', 25),
    maxResults: num('MAX_RESULTS', 5),
    /** Below this NLU confidence we route to general practice instead. */
    minSpecialtyConfidence: 0.45,
  },

  foursquare: {
    apiKey: str('FOURSQUARE_API_KEY', ''),
  },
} as const;

export function assertProductionConfig(): void {
  if (config.env !== 'production') return;
  if (config.osm.userAgent.includes('unset@example.com')) {
    throw new Error('OSM_USER_AGENT must carry a real contact address in production.');
  }
}
