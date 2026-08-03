# PRD: RAG-Powered Symptom-to-Doctor-Appointment Chatbot
**Budget constraint:** $0 — every component below has a free tier or is fully open-source/self-hostable.

## MVP Scope Decisions (locked)
- **Coverage:** Urban/city areas only for MVP — OSM tagging density is high enough in cities to make this reliable without manual data curation. Rural expansion is a post-MVP concern.
- **Booking mode:** Read-only "find + call to book" for MVP — no doctor self-registration or live slot management yet. This removes the hardest operational problem (keeping availability current) from the critical path and keeps the MVP fully achievable at $0. Doctor self-service availability is **Phase 2**.
- **LLM:** Self-hosted open-weights model via **Ollama**, not the Claude API. Note: a Claude Pro subscription is a consumer chat-app plan — it does not include API credits, since Pro and the API are billed separately. Using it programmatically isn't possible with a Pro plan alone, so Ollama is the correct $0 path for MVP triage/NLU. Revisit Claude API (pay-as-you-go, with usage-based pricing) once there's a real budget — it will outperform a small local model on nuanced symptom parsing.

---

## 1. Problem Statement
Users describe symptoms in natural language. The system must (a) route them to the right specialty, (b) never attempt diagnosis, (c) find real nearby doctors/hospitals with semantic reasoning over their descriptions/reviews, and (d) let the user book a slot — all without recurring API cost.

---

## 2. Important Note on Google Maps
**Direct scraping of Google Maps violates Google's Terms of Service.** As of March 2025, Google restructured Places API pricing: the old flat $200/month credit is gone, replaced by **per-SKU free monthly thresholds** — 10,000 free calls/month for Essentials SKUs (basic place search), 5,000/month for Pro SKUs, 1,000/month for Enterprise SKUs (ratings, reviews, photos). These reset monthly and don't roll over, and a Google Cloud billing account (card on file) is still required even to stay in the free band. At low volume (an MVP/personal project), this can function as free — but it is not truly $0-budget since it requires billing setup and any spike in usage risks charges.

**Recommendation for a genuinely $0-budget build: use OpenStreetMap as the primary data source instead**, with Google Places as an optional future upgrade once there's a budget. OSM has no billing account, no card, and no request cap tied to spend.

---

## 3. Zero-Budget API & Tooling Stack

| Layer | Tool | Why it's $0 |
|---|---|---|
| **Places/POI data** | **OpenStreetMap Overpass API** | Fully free, open-data, no API key, no billing account. Query hospitals/clinics/doctors by tag (`amenity=hospital`, `amenity=clinic`, `healthcare=doctor`) within a radius. |
| **Geocoding (address ↔ lat/long)** | **Nominatim** (OSM's geocoder) | Free, but rate-limited to ~1 req/sec — fine for occasional lookups; self-host if you need higher volume. |
| **Reverse geocoding / user location** | Browser Geolocation API (client-side) | Free, built into any browser, no server call needed. |
| **Alternative/supplementary POI source** | **Foursquare Places API** | Free tier (no card required to start; generous monthly call allowance) — good secondary source for richer place descriptions/categories than raw OSM tags. |
| **Embeddings** | **Sentence-Transformers** (e.g. `all-MiniLM-L6-v2`) run locally, or free-tier hosted embedding endpoints | Open-source, runs on CPU, no per-call cost. |
| **Vector store** | **pgvector** extension on **Postgres** (self-hosted, e.g. free tier of Supabase or Neon) | Free self-hosted, or generous free tiers on managed Postgres providers. |
| **LLM for NLU / triage / synthesis** | **Ollama** running a small open-weights model (e.g. Llama 3.1 8B, Mistral 7B, or Phi-3) | Fully local, no API key, no per-call cost, no dependency on Claude Pro (which doesn't include API access). Runs on a modest CPU/GPU — fine for MVP traffic. |
| **Backend** | Spring Boot / Node.js — self-hosted or free tier of Render/Railway/Fly.io | Free tier hosting available for low-traffic MVPs. |
| **Notifications** | Free tier of a transactional email provider (e.g. Resend, Brevo) for confirmations instead of paid SMS | SMS (Twilio etc.) generally has no meaningful free tier — avoid for $0 budget; use email/push instead. |
| **Frontend hosting** | Vercel / Netlify free tier | Free for low-traffic apps. |

**Bottom line:** OSM (Overpass + Nominatim) + Foursquare free tier for data, Sentence-Transformers + pgvector for RAG, and Claude API (or a self-hosted open model) for reasoning gets you to a fully working system with $0 recurring infrastructure cost at MVP scale.

---

## 4. Architecture

```
┌─────────────────┐
│   User (Chat UI)│
└────────┬─────────┘
         │ symptom text + geolocation
         ▼
┌───────────────────────────┐
│  Triage / Safety Layer     │  ← hard-coded red-flag rules, runs FIRST
│  (deterministic, no LLM)   │  → if red flag: show ER info, STOP
└────────┬───────────────────┘
         │ (non-emergency)
         ▼
┌───────────────────────────┐
│  NLU / Specialty Classifier│  ← Ollama (local open model),
│                            │     structured JSON output
└────────┬───────────────────┘
         │ specialty + urgency
         ▼
┌───────────────────────────┐
│  Structured Geo-Filter     │  ← Overpass API query: hospitals/clinics
│  (OSM data, cached in DB)  │     within radius X, tagged with specialty
└────────┬───────────────────┘
         │ candidate list (structured)
         ▼
┌───────────────────────────┐
│  RAG Retrieval             │  ← pgvector similarity search over
│  (semantic re-rank)        │     embedded descriptions/reviews of
│                            │     the already geo-filtered candidates
└────────┬───────────────────┘
         │ ranked doctor/hospital list
         ▼
┌───────────────────────────┐
│  LLM Synthesis             │  ← Ollama explains "why this match,"
│  (grounded, cites only     │     grounded strictly in retrieved data
│   retrieved candidates)    │
└────────┬───────────────────┘
         │
         ▼
┌───────────────────────────┐
│  "Find + Call to Book"     │  ← MVP: show phone number, address,
│  (read-only, MVP)          │     hours — user calls directly.
│                            │     No slot locking/live calendar yet.
└───────────────────────────┘

(Phase 2 adds a real Booking Engine: doctor self-registered
 availability → slot lock → confirm → notify, per section 10.)
```

**Key design rule:** geo-filter *before* vector search, never after. Vector similarity is bad at "nearest"; PostGIS/geo-query is good at it. RAG's job is to rank/explain *within* an already-nearby candidate set, not to find "nearest" on its own.

---

## 5. Data Model

| Table | Key Fields |
|---|---|
| `Symptoms` | id, name, specialty_id, severity_flags |
| `Facilities` (from OSM/Foursquare) | id, name, type (hospital/clinic/doctor), specialty_tags, lat, long, address, phone, source, last_synced_at |
| `FacilityEmbeddings` | facility_id, text_chunk, embedding_vector (pgvector column) |
| `Availability` | facility_id, date, time_slot, status (open/held/booked) |
| `Appointments` | id, patient_id, facility_id, slot_id, status, created_at |
| `Patients` | id, contact_info, location |

---

## 6. Ingestion Pipeline (Zero-Cost)
1. **Scheduled batch job** (e.g. nightly cron, free tier of GitHub Actions or Railway cron): query Overpass API for hospitals/clinics/doctors within bounding boxes for the target city/cities. Urban areas have dense OSM tagging, so this should return solid coverage without manual curation at MVP stage.
2. Supplement with Foursquare free-tier calls for richer category/description text where OSM tags are sparse.
3. Store structured fields in `Facilities`; run unstructured text (name + category + any description) through Sentence-Transformers locally → store vectors in `FacilityEmbeddings`.
4. Re-sync periodically (e.g. weekly) rather than live per-query — keeps everything within free rate limits and avoids hammering Nominatim/Overpass (both have usage policies requiring reasonable request pacing and a valid User-Agent).

---

## 7. Safety & Compliance Notes
- Triage/red-flag layer stays 100% rule-based and upstream of any LLM or RAG step — never let retrieval or generation sit in the critical path for emergency detection.
- LLM synthesis must be constrained to cite only retrieved facility records — never invent a doctor, address, or availability.
- Every response carries a "not a diagnosis" disclaimer.
- Respect OSM's [usage policy](https://operations.osmfoundation.org/policies/nominatim/) (rate limits, attribution, valid User-Agent) and Foursquare's API terms — even free tiers have usage policies that can get a key revoked if ignored.
- If handling real patient health data in production, revisit data residency/consent/retention requirements for your jurisdiction — out of scope for a $0-budget MVP but critical before real users.

---

## 8. Phasing

### MVP (Weeks 1–3) — fully $0
- Overpass-based facility ingestion, scoped to one city
- Rule-based symptom → specialty mapping
- Red-flag triage layer (build first — non-negotiable, even at MVP)
- Structured geo-filter for "nearest matching facility"
- **Read-only "find + call to book"**: show name, address, phone, hours, distance — user calls the facility directly. No slot locking, no live calendar, no doctor accounts.
- Ollama-based NLU for symptom parsing / specialty classification

### V2 (Weeks 4–6) — still $0
- Add Sentence-Transformers embeddings + pgvector RAG layer for semantic ranking/explanation among geo-filtered candidates
- Add Foursquare as secondary data source for richer descriptions
- Expand city coverage to additional urban areas

### Phase 2 — Doctor Self-Registration & Real Booking (still $0-capable)
- Doctor/clinic onboarding flow: self-register facility, set specialty tags, manage availability
- Real `Availability` + `Appointments` tables go live (schema already defined in section 5, unused until this phase)
- Slot locking, confirmation, and booking state machine (as originally architected)
- Notifications via free-tier transactional email (e.g. Resend, Brevo)

### V3 (Future, budget-dependent)
- Upgrade to Google Places API (Pro/Enterprise SKUs) for richer reviews/photos once free thresholds are insufficient
- Two-way doctor calendar sync (Google Calendar/EHR)
- Upgrade NLU/triage to Claude API (pay-as-you-go) for better accuracy than the local Ollama model
- SMS notifications (Twilio) once budget allows

---

## 9. Open Questions (remaining)
- Which specific city launches first — and is there an existing doctor/hospital dataset (e.g. a local health directory) to cross-check against OSM coverage gaps?
- What's the minimum viable hardware for running Ollama reliably in production (even at low MVP traffic, a CPU-only host may be slow — worth benchmarking response time before launch)?
- For "find + call to book," should the bot also surface a click-to-call / WhatsApp link, or just display the number as text?
