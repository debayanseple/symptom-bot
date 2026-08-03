-- ---------------------------------------------------------------------------
-- 001_init — core schema (PRD section 5)
--
-- Tables for the MVP (facilities + embeddings) and the Phase 2 booking engine
-- (patients / availability / appointments). The Phase 2 tables are created now
-- and stay empty until doctor self-registration ships, so the read-only MVP
-- never needs a destructive migration later.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- --- Reference: symptom -> specialty -------------------------------------
-- Mirrors packages/api/src/nlu/symptomRules.ts. The code is the source of
-- truth at request time; this table exists so the mapping can be inspected,
-- reported on, and eventually edited without a deploy.
CREATE TABLE symptoms (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT        NOT NULL,
  specialty     TEXT        NOT NULL,
  weight        INTEGER     NOT NULL DEFAULT 1,
  severity_flag BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, specialty)
);

CREATE INDEX symptoms_specialty_idx ON symptoms (specialty);

-- --- Facilities ----------------------------------------------------------
CREATE TABLE facilities (
  id             BIGSERIAL PRIMARY KEY,
  source         TEXT        NOT NULL CHECK (source IN ('osm', 'foursquare', 'manual')),
  source_id      TEXT        NOT NULL,
  name           TEXT        NOT NULL,
  type           TEXT        NOT NULL CHECK (type IN ('hospital', 'clinic', 'doctor', 'dentist', 'pharmacy')),
  specialty_tags TEXT[]      NOT NULL DEFAULT '{}',
  lat            DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon            DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN -180 AND 180),
  address        TEXT,
  phone          TEXT,
  website        TEXT,
  opening_hours  TEXT,
  emergency      BOOLEAN     NOT NULL DEFAULT FALSE,
  description    TEXT,
  city_key       TEXT        NOT NULL,
  raw_tags       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Re-ingestion upserts on this pair, so a nightly sync never duplicates.
  UNIQUE (source, source_id)
);

-- Geo prefilter. The chat query bounds lat/lon first, then computes exact
-- haversine distance on the (small) surviving set.
CREATE INDEX facilities_latlon_idx     ON facilities (lat, lon);
CREATE INDEX facilities_specialty_idx  ON facilities USING GIN (specialty_tags);
CREATE INDEX facilities_type_idx       ON facilities (type);
CREATE INDEX facilities_emergency_idx  ON facilities (emergency) WHERE emergency = TRUE;
CREATE INDEX facilities_city_idx       ON facilities (city_key);
CREATE INDEX facilities_name_trgm_idx  ON facilities USING GIN (name gin_trgm_ops);

-- --- Embeddings (V2 RAG layer) -------------------------------------------
-- 384 dimensions == all-MiniLM-L6-v2. Changing EMBEDDING_MODEL means changing
-- this column width and re-running the embedding build.
CREATE TABLE facility_embeddings (
  id          BIGSERIAL PRIMARY KEY,
  facility_id BIGINT      NOT NULL REFERENCES facilities (id) ON DELETE CASCADE,
  chunk_index INTEGER     NOT NULL DEFAULT 0,
  text_chunk  TEXT        NOT NULL,
  embedding   vector(384) NOT NULL,
  model       TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (facility_id, chunk_index)
);

-- IVFFlat needs ANALYZE + data before it helps; at MVP row counts a sequential
-- scan over a geo-filtered subset is fine either way. Listed here so the index
-- exists once the table grows.
CREATE INDEX facility_embeddings_vector_idx
  ON facility_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX facility_embeddings_facility_idx ON facility_embeddings (facility_id);

-- --- Phase 2: patients, availability, appointments -----------------------
CREATE TABLE patients (
  id           BIGSERIAL PRIMARY KEY,
  contact_info TEXT        NOT NULL,
  lat          DOUBLE PRECISION,
  lon          DOUBLE PRECISION,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE availability (
  id          BIGSERIAL PRIMARY KEY,
  facility_id BIGINT      NOT NULL REFERENCES facilities (id) ON DELETE CASCADE,
  slot_start  TIMESTAMPTZ NOT NULL,
  slot_end    TIMESTAMPTZ NOT NULL,
  status      TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'held', 'booked')),
  held_until  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (slot_end > slot_start),
  UNIQUE (facility_id, slot_start)
);

CREATE INDEX availability_lookup_idx ON availability (facility_id, slot_start) WHERE status = 'open';

CREATE TABLE appointments (
  id         BIGSERIAL PRIMARY KEY,
  patient_id BIGINT      NOT NULL REFERENCES patients (id) ON DELETE CASCADE,
  slot_id    BIGINT      NOT NULL REFERENCES availability (id) ON DELETE RESTRICT,
  status     TEXT        NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One live appointment per slot; the partial unique index is what makes slot
  -- locking race-free without an advisory lock.
  UNIQUE (slot_id)
);

CREATE INDEX appointments_patient_idx ON appointments (patient_id);

-- --- Ingestion bookkeeping ----------------------------------------------
CREATE TABLE ingest_runs (
  id              BIGSERIAL PRIMARY KEY,
  city_key        TEXT        NOT NULL,
  source          TEXT        NOT NULL,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  facilities_seen INTEGER     NOT NULL DEFAULT 0,
  facilities_upserted INTEGER NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  error           TEXT
);

CREATE INDEX ingest_runs_city_idx ON ingest_runs (city_key, started_at DESC);

-- --- Great-circle distance in SQL ---------------------------------------
-- Avoids a PostGIS dependency: pgvector images do not ship PostGIS, and the
-- only geo operation this app needs is point-to-point distance.
CREATE OR REPLACE FUNCTION haversine_km(
  lat1 DOUBLE PRECISION, lon1 DOUBLE PRECISION,
  lat2 DOUBLE PRECISION, lon2 DOUBLE PRECISION
) RETURNS DOUBLE PRECISION AS $$
  SELECT 2 * 6371.0088 * asin(
    least(1, sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) *
      power(sin(radians(lon2 - lon1) / 2), 2)
    ))
  );
$$ LANGUAGE SQL IMMUTABLE PARALLEL SAFE;
