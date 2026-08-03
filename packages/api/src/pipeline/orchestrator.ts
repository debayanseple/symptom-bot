import { DISCLAIMER, isValidCoordinates, specialtyLabel } from '@calldoc/shared';
import type { ChatRequest, ChatResponse, Coordinates } from '@calldoc/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { detectRedFlags } from '../triage/redFlags.js';
import { buildEmergencyResponse } from '../triage/emergencyResponse.js';
import { analyseSymptoms } from '../nlu/classifier.js';
import { findNearbyWithExpansion, findNearestEmergency } from '../geo/facilityRepo.js';
import { rerank } from '../rag/retriever.js';
import { synthesiseExplanation } from '../llm/synthesis.js';
import { geocode } from '../geo/nominatim.js';

/**
 * The request pipeline, in the order the PRD locks down:
 *
 *   1. Deterministic red-flag triage  (no LLM, no DB, runs first, can stop)
 *   2. NLU / specialty classification (rules + Ollama)
 *   3. Structured geo-filter          (Postgres, bounding box + haversine)
 *   4. RAG semantic re-rank           (pgvector, within the geo-filtered set)
 *   5. Grounded LLM synthesis         (cites only retrieved records)
 *
 * Step 1 must never move. Steps 4 and 5 must degrade gracefully — the whole
 * thing has to keep working when Ollama or the embedding model is unavailable.
 */
export async function handleChat(request: ChatRequest): Promise<ChatResponse> {
  const message = request.message.trim();

  if (message.length < 3) {
    return {
      kind: 'clarification',
      message: 'Tell me what you are feeling — for example "sore throat and fever for three days".',
      needs: ['symptoms'],
      disclaimer: DISCLAIMER,
    };
  }

  // --- 1. Triage ---------------------------------------------------------
  // Runs before location resolution so an emergency is never gated on the user
  // having shared their coordinates.
  const triage = detectRedFlags(message);
  if (triage.isEmergency) {
    logger.warn(
      { rules: triage.matches.map((m) => m.ruleId) },
      'red flag triggered — emergency response',
    );

    const location = await resolveLocation(request);
    const nearestEmergency = location
      ? await findNearestEmergency(location, 3).catch((error) => {
          // A DB failure must not suppress the emergency message itself.
          logger.error({ err: String(error) }, 'emergency facility lookup failed');
          return [];
        })
      : [];

    return buildEmergencyResponse(
      triage,
      nearestEmergency.map((facility) => ({
        ...facility,
        score: 1,
        reason: `${facility.emergency ? 'Emergency department' : 'Hospital'} ${facility.distanceKm.toFixed(1)} km away.`,
      })),
    );
  }

  // --- Location ----------------------------------------------------------
  const location = await resolveLocation(request);
  if (!location) {
    return {
      kind: 'clarification',
      message:
        'I can suggest the right kind of doctor, but I need to know where you are to find one nearby. Share your location, or tell me the area you are in.',
      needs: ['location'],
      disclaimer: DISCLAIMER,
    };
  }

  // --- 2. NLU ------------------------------------------------------------
  const analysis = await analyseSymptoms(message);
  logger.info(
    { specialty: analysis.specialty, confidence: analysis.confidence, source: analysis.source },
    'symptom analysis',
  );

  // --- 3. Geo-filter (structured, BEFORE any vector search) --------------
  const requestedRadius = clamp(
    request.radiusKm ?? config.search.defaultRadiusKm,
    1,
    config.search.maxRadiusKm,
  );

  let { facilities, radiusKm, expanded } = await findNearbyWithExpansion(
    { centre: location, radiusKm: requestedRadius, specialty: analysis.specialty, limit: 40 },
    config.search.maxRadiusKm,
  );

  // Nothing tagged for this specialty anywhere in range — fall back to general
  // practice, which can assess and refer. Better than an empty result.
  let fellBackToGP = false;
  if (facilities.length === 0 && analysis.specialty !== 'general_practice') {
    const fallback = await findNearbyWithExpansion(
      {
        centre: location,
        radiusKm: requestedRadius,
        specialty: 'general_practice',
        limit: 40,
      },
      config.search.maxRadiusKm,
    );
    facilities = fallback.facilities;
    radiusKm = fallback.radiusKm;
    expanded = expanded || fallback.expanded;
    fellBackToGP = facilities.length > 0;
  }

  // --- 4. RAG re-rank (within the geo-filtered candidate set) ------------
  const ranked = (await rerank(facilities, message, analysis.specialty, config.search.maxRadiusKm))
    .slice(0, config.search.maxResults);

  // --- 5. Grounded synthesis ---------------------------------------------
  let summary = await synthesiseExplanation(message, analysis, ranked);
  if (fellBackToGP) {
    summary = `No facility in range is specifically listed for ${specialtyLabel(analysis.specialty).toLowerCase()}, so these are general practices that can assess you and refer you on. ${summary}`;
  }

  return {
    kind: 'recommendation',
    analysis,
    specialtyLabel: specialtyLabel(analysis.specialty),
    message: summary,
    facilities: ranked,
    radiusExpanded: expanded,
    radiusKm,
    disclaimer: DISCLAIMER,
  };
}

/**
 * Browser geolocation is preferred (free, precise, no server call). Free-text
 * place names fall back to Nominatim, which is rate-limited to 1 req/sec.
 */
async function resolveLocation(request: ChatRequest): Promise<Coordinates | undefined> {
  if (isValidCoordinates(request.location)) return request.location;

  if (request.locationText?.trim()) {
    const geocoded = await geocode(request.locationText);
    if (geocoded) return { lat: geocoded.lat, lon: geocoded.lon };
  }

  return undefined;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));
