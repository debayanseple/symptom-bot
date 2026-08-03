import { SPECIALTIES, isSpecialty } from '@calldoc/shared';
import type { Specialty, SymptomAnalysis } from '@calldoc/shared';
import { z } from 'zod';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { generate } from '../llm/ollamaClient.js';
import { classifyByRules } from './symptomRules.js';

const SYSTEM_PROMPT = `You are a medical triage routing assistant. You do NOT diagnose and you do NOT give medical advice.

Your only job: read a patient's description of their symptoms and decide which medical specialty is most appropriate for them to see, plus how soon.

Rules:
- Choose exactly one specialty from the allowed list.
- If the description is vague, mild, or spans several body systems, choose "general_practice".
- Never choose "emergency" — emergencies are handled by a separate system before you are called.
- Urgency: "urgent" = should be seen within 24-48h. "soon" = within a week. "routine" = no time pressure.
- "symptoms" must contain only short phrases lifted from what the patient actually said. Do not add symptoms they did not mention.
- Reply with JSON only. No prose, no markdown fences.`;

/** Ollama supports a JSON Schema in `format`, which removes most parse failures. */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    specialty: { type: 'string', enum: SPECIALTIES.filter((s) => s !== 'emergency') },
    urgency: { type: 'string', enum: ['urgent', 'soon', 'routine'] },
    confidence: { type: 'number' },
    symptoms: { type: 'array', items: { type: 'string' } },
  },
  required: ['specialty', 'urgency', 'confidence', 'symptoms'],
} as const;

const llmSchema = z.object({
  specialty: z.string(),
  urgency: z.enum(['urgent', 'soon', 'routine']),
  confidence: z.number().min(0).max(1).catch(0.5),
  symptoms: z.array(z.string()).max(12).catch([]),
});

/**
 * Two-layer classification. Rules run always and cheaply; the LLM runs on top
 * and is allowed to override only when it is at least as confident as the
 * rules. The rule layer is therefore a floor on quality, not a fallback that
 * only fires on hard errors.
 */
export async function analyseSymptoms(message: string): Promise<SymptomAnalysis> {
  const rules = classifyByRules(message);

  if (!config.llm.enabled) {
    return finalise(rules.specialty, rules.confidence, rules.matchedSymptoms, 'rules');
  }

  try {
    const raw = await generate(`Patient description:\n"""${message.slice(0, 2000)}"""`, {
      system: SYSTEM_PROMPT,
      format: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      temperature: 0.1,
      maxTokens: 300,
    });

    const parsed = llmSchema.safeParse(JSON.parse(stripFences(raw)));
    if (!parsed.success) {
      logger.warn({ raw, issues: parsed.error.issues }, 'LLM classification failed schema');
      return finalise(rules.specialty, rules.confidence, rules.matchedSymptoms, 'rules');
    }

    const llmSpecialty: Specialty = isSpecialty(parsed.data.specialty)
      ? parsed.data.specialty
      : 'general_practice';

    // The model must never escalate to emergency — that decision belongs to
    // the deterministic layer that already ran and cleared this message.
    const safeSpecialty = llmSpecialty === 'emergency' ? 'general_practice' : llmSpecialty;

    const agree = safeSpecialty === rules.specialty;
    if (agree) {
      const symptoms = merge(parsed.data.symptoms, rules.matchedSymptoms);
      return finalise(
        safeSpecialty,
        Math.min(0.98, Math.max(rules.confidence, parsed.data.confidence) + 0.15),
        symptoms,
        'llm+rules',
        parsed.data.urgency,
      );
    }

    // Disagreement: trust the rules when they were confident, otherwise the LLM.
    if (rules.confidence >= 0.7 && rules.confidence > parsed.data.confidence) {
      logger.debug(
        { rules: rules.specialty, llm: safeSpecialty },
        'rules override LLM classification',
      );
      return finalise(rules.specialty, rules.confidence, rules.matchedSymptoms, 'rules');
    }

    return finalise(
      safeSpecialty,
      parsed.data.confidence,
      merge(parsed.data.symptoms, rules.matchedSymptoms),
      'llm',
      parsed.data.urgency,
    );
  } catch (error) {
    logger.warn({ err: String(error) }, 'LLM classification unavailable, using rules');
    return finalise(rules.specialty, rules.confidence, rules.matchedSymptoms, 'rules');
  }
}

function finalise(
  specialty: Specialty,
  confidence: number,
  symptoms: string[],
  source: SymptomAnalysis['source'],
  urgency: SymptomAnalysis['urgency'] = 'soon',
): SymptomAnalysis {
  // Low confidence routes to a GP rather than guessing a narrow specialist the
  // user would have to be referred away from anyway.
  if (confidence < config.search.minSpecialtyConfidence && specialty !== 'general_practice') {
    return {
      specialty: 'general_practice',
      urgency,
      confidence,
      symptoms,
      source: 'fallback',
    };
  }
  return { specialty, urgency, confidence, symptoms, source };
}

function merge(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b].map((s) => s.trim().toLowerCase()).filter(Boolean))].slice(0, 12);
}

/** Small models sometimes wrap JSON in markdown fences despite instructions. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}
