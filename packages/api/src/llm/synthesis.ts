import { formatDistance, specialtyLabel } from '@calldoc/shared';
import type { RankedFacility, SymptomAnalysis } from '@calldoc/shared';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { generate } from './ollamaClient.js';

const SYSTEM_PROMPT = `You write one short paragraph explaining a doctor recommendation to a patient.

ABSOLUTE RULES — breaking any of these is a failure:
- Use ONLY facts from the FACILITIES list you are given. Never invent a name, address, phone number, doctor, rating, waiting time, or opening hour.
- Never diagnose. Never name a disease or condition the patient might have. Never suggest medication or treatment.
- Never say a facility is "the best", "highly rated", or "recommended by patients" — you have no such data.
- Do not repeat the full address or phone number; the interface already shows them.
- Refer to facilities by name only.
- 2 to 4 sentences. Plain, calm language. No lists, no markdown, no headings.

Say which type of doctor fits the symptoms and why the listed options suit, based only on their distance, type, and listed specialties.`;

/**
 * Grounded synthesis. Everything the model can see is a whitelisted projection
 * of the retrieved records — it has no access to the wider database and no way
 * to reference a facility that was not retrieved.
 */
export async function synthesiseExplanation(
  userMessage: string,
  analysis: SymptomAnalysis,
  facilities: RankedFacility[],
): Promise<string> {
  const deterministic = templateSummary(analysis, facilities);

  if (!config.llm.enabled || facilities.length === 0) return deterministic;

  const context = facilities
    .map((facility, index) =>
      [
        `${index + 1}. ${facility.name}`,
        `   type: ${facility.type}`,
        `   distance: ${formatDistance(facility.distanceKm)}`,
        `   listed specialties: ${facility.specialtyTags.map(specialtyLabel).join(', ') || 'none listed'}`,
        `   emergency department: ${facility.emergency ? 'yes' : 'no'}`,
        `   opening hours: ${facility.openingHours ?? 'not listed'}`,
        `   phone listed: ${facility.phone ? 'yes' : 'no'}`,
      ].join('\n'),
    )
    .join('\n');

  const prompt = [
    `PATIENT SAID: "${userMessage.slice(0, 800)}"`,
    `ROUTED TO SPECIALTY: ${specialtyLabel(analysis.specialty)}`,
    '',
    'FACILITIES (the only facilities that exist for this answer):',
    context,
    '',
    'Write the explanation paragraph now.',
  ].join('\n');

  try {
    const raw = await generate(prompt, {
      system: SYSTEM_PROMPT,
      temperature: 0.3,
      maxTokens: 220,
    });

    const cleaned = raw.trim().replace(/^["']|["']$/g, '');
    if (!isGrounded(cleaned, facilities)) {
      logger.warn({ cleaned }, 'synthesis failed grounding check, using template');
      return deterministic;
    }
    return cleaned;
  } catch (error) {
    logger.warn({ err: String(error) }, 'synthesis unavailable, using template');
    return deterministic;
  }
}

/**
 * Post-hoc grounding guard. A prompt is not a guarantee, so this rejects
 * output that looks like the model hallucinated or drifted into diagnosis.
 */
export function isGrounded(text: string, facilities: RankedFacility[]): boolean {
  if (!text || text.length < 20 || text.length > 1500) return false;

  const lower = text.toLowerCase();

  // Diagnosis and treatment language — the one thing this product must never do.
  const forbidden = [
    'you (probably )?have',
    'you may have',
    'you might have',
    'diagnos',
    'i recommend taking',
    'you should take',
    'prescri',
    'mg\\b',
    'dosage',
    'best rated',
    'highly rated',
    'top rated',
    '\\d+(\\.\\d+)?\\s*(star|out of 5)',
    'reviews say',
    'patients say',
  ];
  if (forbidden.some((pattern) => new RegExp(pattern, 'i').test(lower))) return false;

  // Any capitalised multi-word name that is not one of ours is a likely
  // hallucinated facility. Checked loosely: we only reject when the text names
  // something that pattern-matches a clinic/hospital we did not retrieve.
  const known = facilities.map((f) => f.name.toLowerCase());
  const nameLike = text.match(/\b[A-Z][\w'-]+(?:\s+[A-Z][\w'-]+){0,4}\s+(Hospital|Clinic|Medical Centre|Medical Center|Nursing Home|Polyclinic)\b/g);
  if (nameLike) {
    for (const candidate of nameLike) {
      const normalised = candidate.toLowerCase();
      if (!known.some((name) => name.includes(normalised) || normalised.includes(name))) {
        return false;
      }
    }
  }

  return true;
}

/** Fully deterministic summary. Always safe, always available. */
export function templateSummary(
  analysis: SymptomAnalysis,
  facilities: RankedFacility[],
): string {
  const label = specialtyLabel(analysis.specialty);

  if (facilities.length === 0) {
    return `Based on what you described, ${label.toLowerCase()} looks like the right starting point — but no matching facility was found in the area covered so far. Try widening the search radius, or check with a local general practice.`;
  }

  const nearest = facilities[0]!;
  const urgency =
    analysis.urgency === 'urgent'
      ? 'It would be worth arranging this within the next day or two.'
      : analysis.urgency === 'soon'
        ? 'Booking something in the next week should be reasonable.'
        : 'There is no particular time pressure indicated.';

  return `Based on what you described, ${label} is the most relevant starting point. The closest option is ${nearest.name}, ${formatDistance(nearest.distanceKm)} away${nearest.phone ? ' — its phone number is listed below so you can call to book' : ', though no phone number is listed for it'}. ${urgency}`;
}
