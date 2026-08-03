# Call Doc

RAG-powered symptom-to-doctor chatbot. Describe symptoms in natural language, get routed to the right specialty, and find real nearby facilities you can call.

Built to the spec in [symptom-chatbot-rag-prd.md](symptom-chatbot-rag-prd.md). **$0 recurring cost** — OpenStreetMap for data, local Sentence-Transformers for embeddings, self-hosted Postgres + pgvector, and Ollama for the LLM. No API keys, no billing account, no card on file.

> **Not a diagnosis tool.** It suggests which kind of doctor may be relevant and where to find one. It never diagnoses, never prescribes, and hands off to emergency services the moment a red flag appears.

---

## Stack

| Layer | Choice |
|---|---|
| Backend | Fastify + TypeScript (Node 20+) |
| Frontend | React + Vite |
| Database | Postgres 16 + `pgvector` |
| Places data | OpenStreetMap Overpass API |
| Geocoding | Nominatim (rate-limited to 1 req/s) |
| Embeddings | `Xenova/all-MiniLM-L6-v2` via transformers.js, in-process on CPU |
| LLM | Ollama (`llama3.1:8b` by default) |

Everything degrades gracefully: with Ollama down the rule-based classifier still routes symptoms; with embeddings missing the structured geo-ranking still works; **the red-flag triage layer has no dependencies at all and is always available.**

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
#    Set OSM_USER_AGENT to include a real contact address — Overpass and
#    Nominatim block requests without one.

# 3. Database (needs Docker; or point DATABASE_URL at a free Supabase/Neon instance)
npm run db:up
npm run db:migrate

# 4. LLM (optional — everything works without it, just less well)
ollama pull llama3.1:8b

# 5. Ingest a city (~1-3 min; Overpass is slow at city scale)
npm run ingest -- kolkata

# 6. Build the RAG vectors (first run downloads a ~23 MB model)
npm run embed

# 7. Run — two terminals
npm run dev:api    # http://localhost:3001
npm run dev:web    # http://localhost:5173
```

Without Docker or Ollama you can still run the API and exercise triage:

```bash
LLM_ENABLED=false npm run dev:api
curl -X POST http://localhost:3001/api/triage \
  -H 'content-type: application/json' \
  -d '{"message":"crushing chest pain and I cannot breathe"}'
```

---

## Request pipeline

The order here is load-bearing and mirrors PRD section 4.

```
user message + location
   │
   ├─ 1. RED-FLAG TRIAGE ─────────── deterministic regex rules, no LLM, no DB
   │      └─ emergency? → ER info + emergency numbers, STOP
   │
   ├─ 2. NLU ────────────────────── keyword rules + Ollama (JSON-schema output)
   │      └─ specialty + urgency + confidence
   │
   ├─ 3. GEO-FILTER ─────────────── Postgres: bbox prefilter → exact haversine
   │      └─ candidate set, all provably nearby
   │
   ├─ 4. RAG RE-RANK ────────────── pgvector cosine, scoped to those candidates
   │      └─ blended distance + specialty + contactability + semantic score
   │
   └─ 5. SYNTHESIS ──────────────── Ollama, grounded, post-hoc guarded
          └─ "find + call to book" card list
```

**Geo-filter before vector search, never after.** Vector similarity is bad at "nearest"; a bounding box plus haversine is exact and index-backed. RAG's job is ranking and explanation *within* an already-nearby set.

---

## Safety design

| Guarantee | How it is enforced |
|---|---|
| Emergencies are never missed because an LLM was down | `src/triage/redFlags.ts` is pure functions — no network, no DB, no model. Runs first, before location is even resolved. |
| An emergency is still shown when the database is unreachable | The nearest-ER lookup is wrapped in a `catch` that degrades to an empty list; the warning itself always renders. Covered by a test. |
| The LLM cannot escalate to "emergency" | `emergency` is stripped from the classifier's allowed enum, and any value that slips through is rewritten to `general_practice`. |
| The LLM cannot invent a facility | Synthesis only sees a whitelisted projection of retrieved records, and `isGrounded()` rejects output naming a hospital/clinic that was not retrieved. |
| The LLM cannot diagnose or prescribe | `isGrounded()` rejects diagnosis phrasing, dosages, prescriptions and invented ratings. Failure falls back to a deterministic template. |
| No response ships without a disclaimer | `DISCLAIMER` is a required field on every response variant in the shared types — it cannot be omitted without a type error. |
| Low-confidence routing does not guess | Below `minSpecialtyConfidence` the request routes to general practice, which can assess and refer. |
| OSM usage policies are respected | Nominatim calls are serialised through a 1 req/s queue; Overpass backs off on 429/504; both send an identifying User-Agent; ingestion is batch, never per-request. |

Red-flag rules bias hard towards false positives. A test enforces that **every rule has a positive test case**, and a second suite checks a list of everyday symptoms never trips the emergency path.

---

## Layout

```
packages/
  shared/          types, specialty taxonomy, geo maths — used by api and web
    src/specialties.ts   the pivot between user words, OSM tags, and LLM output
  api/
    src/triage/          red-flag rules + emergency response  ← runs first
    src/nlu/             keyword classifier + LLM classifier
    src/geo/             Overpass, Nominatim, facility repository (geo-filter)
    src/rag/             embedder, embedding build job, semantic re-ranker
    src/llm/             Ollama client, grounded synthesis + grounding guard
    src/pipeline/        the orchestrator that sequences all of the above
    src/ingest/          city bounding boxes, OSM tag mapper, batch runner
    src/db/              pool, migrations
    test/                92 tests, no external services required
  web/
    src/components/      chat UI, facility cards, emergency panel
.github/workflows/ingest.yml   weekly Overpass re-sync (free tier)
```

---

## API

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` | The full pipeline. `{ message, location? , locationText?, radiusKm? }` |
| `POST /api/triage` | Red-flag layer in isolation — for monitoring and audit |
| `GET /api/facilities/nearby` | Raw structured search, no NLU or RAG. Useful for checking coverage |
| `GET /api/facilities/:id` | Single facility |
| `GET /api/coverage` | Ingested facility counts per city |
| `GET /health` | Liveness |
| `GET /health/ready` | Deep check. Reports `degraded` (not `down`) when only LLM/embeddings are missing |

---

## Adding a city

1. Add a bounding box to `packages/api/src/ingest/cities.ts`.
2. `npm run ingest -- <city-key> && npm run embed`.

MVP scope is **urban areas only** — OSM healthcare tagging is dense enough in cities to be useful without manual curation. Rural coverage is post-MVP.

---

## Scope

**Shipped (MVP + V2 from the PRD):** Overpass ingestion, deterministic triage, rule + LLM specialty classification, structured geo-filter, pgvector semantic re-rank, grounded synthesis, read-only *find + call to book*.

**Deliberately not shipped:** doctor self-registration, live availability, slot locking, booking confirmations, notifications. The `patients` / `availability` / `appointments` tables exist in migration `001` and stay empty until Phase 2, so enabling booking needs no destructive migration.

**Known gaps carried from the PRD's open questions:**
- Ollama hardware sizing for production is unbenchmarked; CPU-only hosts may be slow. `LLM_ENABLED=false` is a working escape hatch.
- OSM coverage has not been cross-checked against a local health directory. `GET /api/coverage` and `GET /api/facilities/nearby` exist to make that audit easy.
- Facilities are surfaced with a `tel:` link. WhatsApp click-to-chat is not implemented.
- Foursquare is wired into config (`FOURSQUARE_API_KEY`) but no secondary-source ingestion is implemented — OSM is the only source today.

---

## Attribution

Facility data © OpenStreetMap contributors, licensed under the [ODbL](https://www.openstreetmap.org/copyright). Attribution is rendered in the app footer; keep it there.
