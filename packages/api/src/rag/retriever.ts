import { formatDistance, specialtyLabel } from '@calldoc/shared';
import type { RankedFacility, Specialty } from '@calldoc/shared';
import { config } from '../config.js';
import { query } from '../db/pool.js';
import { logger } from '../logger.js';
import type { NearbyFacility } from '../geo/facilityRepo.js';
import { embedOne, toVectorLiteral } from './embedder.js';

/**
 * Semantic re-rank over an ALREADY geo-filtered candidate set.
 *
 * The vector search is scoped by `WHERE facility_id = ANY(...)` — it never
 * searches the whole table. Retrieval's job here is ordering and explanation
 * within a set that structured geo-filtering already proved is nearby.
 */
export async function rerank(
  candidates: NearbyFacility[],
  userQuery: string,
  specialty: Specialty,
  /**
   * The radius actually searched, NOT the configured maximum. Normalising
   * against the maximum compresses every distance into the top of the range
   * (at an 8 km search, 2 km and 7 km both score ~0.9 against a 25 km ceiling),
   * which let the small contactability term outrank a facility three times
   * closer. Normalising against the effective radius keeps distance dominant.
   */
  searchRadiusKm: number,
): Promise<RankedFacility[]> {
  if (candidates.length === 0) return [];

  const semanticScores = config.rag.enabled
    ? await semanticSimilarity(candidates, userQuery, specialty)
    : new Map<string, number>();

  return candidates
    .map((facility) => {
      const semanticScore = semanticScores.get(facility.id);
      const score = blendScore(facility, semanticScore, specialty, searchRadiusKm);
      return {
        ...facility,
        ...(semanticScore === undefined ? {} : { semanticScore }),
        score,
        reason: templateReason(facility, specialty),
      } satisfies RankedFacility;
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Cosine similarity between the user's symptom text and each candidate's
 * embedded description. Returns an empty map (not an error) when embeddings
 * have not been built yet — the MVP works without them, V2 improves with them.
 */
async function semanticSimilarity(
  candidates: NearbyFacility[],
  userQuery: string,
  specialty: Specialty,
): Promise<Map<string, number>> {
  try {
    // Embedding the specialty label alongside the raw symptom text anchors the
    // query in the same vocabulary the facility descriptions use.
    const queryText = `Patient needs: ${specialtyLabel(specialty)}. Symptoms: ${userQuery}`;
    const vector = await embedOne(queryText);

    const { rows } = await query<{ facility_id: string; similarity: number }>(
      `
      SELECT facility_id,
             1 - (embedding <=> $1::vector) AS similarity
      FROM facility_embeddings
      WHERE facility_id = ANY($2::bigint[])
        AND chunk_index = 0
      `,
      [toVectorLiteral(vector), candidates.map((c) => c.id)],
    );

    if (rows.length === 0) {
      logger.debug('no embeddings for candidate set — falling back to structured ranking');
    }

    return new Map(rows.map((row) => [String(row.facility_id), Number(row.similarity)]));
  } catch (error) {
    logger.warn({ err: String(error) }, 'semantic rerank unavailable, using structured ranking');
    return new Map();
  }
}

/**
 * Blended ranking. Distance dominates because a semantically perfect match
 * 20 km away is worse than a good one 2 km away — the user has to physically
 * get there.
 */
function blendScore(
  facility: NearbyFacility,
  semanticScore: number | undefined,
  specialty: Specialty,
  searchRadiusKm: number,
): number {
  const proximity = Math.max(0, 1 - facility.distanceKm / Math.max(1, searchRadiusKm));

  // Explicitly tagged with the requested specialty beats a generic listing.
  const exactSpecialty = facility.specialtyTags.includes(specialty) ? 1 : 0;
  const generalFallback = facility.specialtyTags.includes('general_practice') ? 0.4 : 0;
  const specialtyMatch = Math.max(exactSpecialty, generalFallback);

  // Data completeness matters a lot for a "call to book" MVP: a listing with
  // no phone number is close to useless.
  const contactable = (facility.phone ? 0.7 : 0) + (facility.openingHours ? 0.3 : 0);

  const semantic = semanticScore ?? 0;
  const semanticWeight = semanticScore === undefined ? 0 : 0.2;

  return Number(
    (
      0.4 * proximity +
      0.25 * specialtyMatch +
      0.15 * contactable +
      semanticWeight * semantic
    ).toFixed(4),
  );
}

/**
 * Deterministic fallback explanation, used when LLM synthesis is unavailable
 * and as the base text the LLM is allowed to refine. Every clause is derived
 * from a stored field — nothing here can be invented.
 */
function templateReason(facility: NearbyFacility, specialty: Specialty): string {
  const bits: string[] = [];

  if (facility.specialtyTags.includes(specialty)) {
    bits.push(`listed for ${specialtyLabel(specialty).toLowerCase()}`);
  } else if (facility.type === 'hospital') {
    bits.push('a general hospital that can refer you on');
  } else {
    bits.push('a general practice that can assess and refer you');
  }

  bits.push(`${formatDistance(facility.distanceKm)} away`);
  if (facility.emergency) bits.push('has an emergency department');
  if (facility.openingHours === '24/7') bits.push('open 24 hours');
  if (!facility.phone) bits.push('no phone number listed in OpenStreetMap');

  return `${bits.join(', ')}.`;
}
