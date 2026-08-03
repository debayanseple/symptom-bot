import { DISCLAIMER, isValidCoordinates, specialtyLabel } from '@calldoc/shared';
import type {
  ChatRequest,
  ChatResponse,
  Coordinates,
  DirectoryResponse,
  RankedFacility,
} from '@calldoc/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { detectRedFlags } from '../triage/redFlags.js';
import { buildEmergencyResponse } from '../triage/emergencyResponse.js';
import { analyseSymptoms } from '../nlu/classifier.js';
import { findNearbyWithExpansion, findNearestEmergency, searchByName } from '../geo/facilityRepo.js';
import type { NearbyFacility } from '../geo/facilityRepo.js';
import { rerank } from '../rag/retriever.js';
import { synthesiseExplanation } from '../llm/synthesis.js';
import { geocode } from '../geo/nominatim.js';
import { dedupeAgainst, searchGooglePlaces } from '../places/googlePlaces.js';

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

  // --- Name lookup -------------------------------------------------------
  // Runs before the symptom path, and before the location requirement, because
  // "Dr Chopra" and "Ruby General" are requests for a specific place — not
  // descriptions of a complaint, and not something to refuse without GPS.
  const directory = await tryNameLookup(message, location);
  if (directory) return directory;

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

  // --- 3b. Google Places (live, optional) --------------------------------
  // Runs alongside the OSM geo-filter rather than replacing it. Google has far
  // better coverage of Indian clinics — phone numbers especially — but its
  // results cannot be stored, so they join the candidate set in memory only.
  const googleResults = await searchGooglePlaces(analysis.specialty, location, radiusKm);
  const freshGoogle = dedupeAgainst(googleResults, facilities).filter(
    (place) => place.distanceKm <= radiusKm,
  );

  if (freshGoogle.length > 0) {
    logger.info(
      { google: freshGoogle.length, osm: facilities.length },
      'merged google places results',
    );
  }

  // --- 4. RAG re-rank (within the geo-filtered candidate set) ------------
  // `radiusKm` here is the radius the search actually settled on, which may be
  // wider than requested if the first pass found nothing.
  const ranked = (
    await rerank([...facilities, ...freshGoogle], message, analysis.specialty, radiusKm)
  ).slice(0, config.search.maxResults);

  const usedGoogle = ranked.some((facility) => facility.source === 'google');

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
    attribution: usedGoogle ? 'google' : 'osm',
    disclaimer: DISCLAIMER,
  };
}

/**
 * Words that mean "I am naming a place", and words that mean "I am describing
 * a complaint". Used to decide how confident a name match has to be before it
 * outranks the symptom pipeline.
 */
const NAME_INTENT = /\b(dr|doctor|prof|hospital|clinic|nursing home|polyclinic|centre|center|institute|foundation|college|diagnostics?)\b/i;
const SYMPTOM_INTENT =
  /\b(pain|ache|aching|hurts?|hurting|sore|fever|cough|rash|itch\w*|swollen|swelling|bleeding|vomit\w*|nausea|dizzy|dizziness|tired|weak\w*|symptom|feeling|felt|since|days?|weeks?)\b/i;

/**
 * Decides whether the message is a lookup by name and, if so, answers it.
 *
 * Returns undefined when the message does not look like a name search, so the
 * caller falls through to the symptom pipeline. The thresholds are asymmetric
 * on purpose: a symptom description that happens to resemble a facility name
 * must not hijack triage-adjacent routing, so anything carrying symptom
 * vocabulary needs a near-exact name match to qualify.
 */
async function tryNameLookup(
  message: string,
  location: Coordinates | undefined,
): Promise<DirectoryResponse | undefined> {
  const term = message.trim().replace(/^(find|search|show|looking for|where is|locate)\s+/i, '');
  if (term.length < 3 || term.length > 80) return undefined;

  const namesAPlace = NAME_INTENT.test(term);
  const describesSymptoms = SYMPTOM_INTENT.test(term);

  // "chest pain clinic" mentions a place word but is plainly a complaint.
  if (describesSymptoms && !namesAPlace) return undefined;

  const threshold = describesSymptoms ? 0.85 : namesAPlace ? 0.4 : 0.55;

  let matches: Awaited<ReturnType<typeof searchByName>>;
  try {
    matches = await searchByName(term, {
      ...(location ? { centre: location } : {}),
      limit: 8,
      minSimilarity: threshold,
    });
  } catch (error) {
    logger.warn({ err: String(error) }, 'name lookup failed, falling through to symptoms');
    return undefined;
  }

  if (matches.length === 0) return undefined;

  const facilities: RankedFacility[] = matches.map(({ facility, similarity }) => ({
    ...facility,
    score: similarity,
    reason: describeMatch(facility, Boolean(location)),
  }));

  const named = facilities.filter((f) => f.practitioner).length;
  const message_ =
    facilities.length === 1
      ? `Found ${facilities[0]!.practitioner ?? facilities[0]!.name}.`
      : `Found ${facilities.length} matches for "${term}"${named > 0 ? `, ${named} listed under a doctor's name` : ''}.`;

  return {
    kind: 'directory',
    query: term,
    message: `${message_}${location ? '' : ' Share your location to see how far away they are.'}`,
    facilities,
    hasLocation: Boolean(location),
    disclaimer: DISCLAIMER,
  };
}

function describeMatch(facility: NearbyFacility, hasLocation: boolean): string {
  const bits: string[] = [];
  if (facility.practitioner) bits.push(`listed under ${facility.practitioner}`);
  if (facility.specialtyTags.length && facility.specialtyTags[0] !== 'general_practice') {
    bits.push(facility.specialtyTags.map(specialtyLabel).join(', ').toLowerCase());
  }
  if (hasLocation) bits.push(`${facility.distanceKm.toFixed(1)} km away`);
  if (facility.emergency) bits.push('has an emergency department');
  if (!facility.phone) bits.push('no phone number listed in OpenStreetMap');
  return bits.length ? `${bits.join(', ')}.` : 'Listed in OpenStreetMap.';
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
