import type { RedFlagMatch, TriageResult } from '@calldoc/shared';

/**
 * DETERMINISTIC EMERGENCY DETECTION.
 *
 * This module runs FIRST, before any LLM or retrieval call, and is the only
 * thing standing between a user describing a heart attack and a chatbot
 * cheerfully offering them a cardiology clinic three days out.
 *
 * Hard rules for anything in this file:
 *   1. No network calls. No LLM. No database. Pure functions only.
 *   2. Bias towards false positives. Sending someone to A&E who did not need
 *      to go is a bad afternoon; the inverse is a fatality.
 *   3. Every rule needs a test in test/redFlags.test.ts.
 */

export interface RedFlagRule {
  id: string;
  concern: string;
  /**
   * Patterns are matched against the lowercased message. Word boundaries are
   * required on both ends of each phrase so "cold" does not fire on "colder"
   * and — more importantly — "chest pain" does not fire on "chest painting".
   */
  patterns: RegExp[];
  /**
   * Optional negation guard. If any of these patterns also match, the rule is
   * suppressed. Keeps "no chest pain" and "worried about a stroke someday"
   * from triggering an emergency response.
   */
  suppressIf?: RegExp[];
}

/** Builds a case-insensitive, word-boundary-anchored alternation. */
const phrases = (...list: string[]): RegExp[] =>
  list.map((p) => new RegExp(`(?<![a-z])${p.replace(/\s+/g, '\\s+')}(?![a-z])`, 'i'));

/**
 * Negation and hypothetical framing that should suppress a red flag. Applied
 * within a short window before the matched phrase, so "I have a headache but
 * no chest pain" suppresses correctly while "no appetite, and chest pain"
 * still fires.
 */
const NEGATION_WINDOW = 24;
const NEGATION_PATTERN =
  /\b(no|not|never|without|denies|don'?t have|doesn'?t have|didn'?t have|free of|ruled out|negative for)\b[^.!?;]{0,24}$/i;

export const RED_FLAG_RULES: RedFlagRule[] = [
  {
    id: 'cardiac.chest_pain',
    concern: 'Chest pain or pressure, which can indicate a heart attack',
    patterns: phrases(
      'chest pain',
      'pain in (my |the )?chest',
      'chest pressure',
      'pressure in (my |the )?chest',
      'tightness in (my |the )?chest',
      'chest tightness',
      'crushing chest',
      'heart attack',
      'cardiac arrest',
      'squeezing (feeling )?in (my |the )?chest',
      // "my chest hurts" is the same complaint as "chest pain" and was
      // previously reaching the non-emergency path.
      'chest (is |feels )?(hurting|hurts|aching|burning|sore|heavy|tight)',
      'sore chest',
      'burning in (my |the )?chest',
    ),
  },
  {
    id: 'cardiac.radiating_pain',
    concern: 'Pain radiating to the arm, jaw or back alongside chest discomfort',
    patterns: phrases(
      'pain (is |was )?(radiating|spreading|going|shooting) (down|to|into|through) (my |the )?(left |right )?arm',
      'jaw pain (and|with) (chest|sweating|nausea)',
      'arm (and|with) jaw pain',
    ),
  },
  {
    id: 'respiratory.severe',
    concern: 'Severe difficulty breathing',
    patterns: phrases(
      "can'?t breathe",
      'cannot breathe',
      'unable to breathe',
      'struggling to breathe',
      'gasping for (air|breath)',
      'stopped breathing',
      'not breathing',
      'choking',
      'turning blue',
      'lips (are |turned )?blue',
      'severe (shortness of breath|breathlessness)',
      'suffocating',
    ),
  },
  {
    id: 'neuro.stroke',
    concern: 'Possible stroke (FAST signs: face, arm, speech, time)',
    patterns: phrases(
      'stroke',
      'face (is )?drooping',
      'drooping (on one side|face)',
      'one side of (my |the )?(face|body) (is )?(numb|weak|droop)',
      'slurred speech',
      "can'?t speak",
      'sudden (numbness|weakness) (on|in) one side',
      'sudden confusion',
      'sudden (vision|visual) loss',
      "can'?t (lift|raise|move) (my|one) arm",
      'paralysis',
      'paralysed',
      'paralyzed',
    ),
  },
  {
    id: 'neuro.head_injury',
    concern: 'Serious head injury',
    patterns: phrases(
      'head injury',
      'hit (my|his|her|their) head (hard|badly)',
      'skull fracture',
      'bleeding from (the |my )?(ear|nose) after',
      'knocked (out|unconscious)',
    ),
  },
  {
    id: 'neuro.consciousness',
    concern: 'Loss of consciousness, seizure or unresponsiveness',
    patterns: phrases(
      'unconscious',
      'unresponsive',
      'passed out',
      'fainted',
      'blacked out',
      'seizure',
      'convulsion',
      'convulsing',
      'fitting',
      "won'?t wake up",
      'not waking up',
      'comatose',
    ),
  },
  {
    id: 'trauma.bleeding',
    concern: 'Severe or uncontrolled bleeding',
    patterns: phrases(
      'severe bleeding',
      'heavy bleeding',
      'bleeding (a lot|heavily|badly)',
      // Allow a short clause between the two halves: people write "it is
      // bleeding and it won't stop" far more often than "bleeding won't stop".
      "bleeding[^.!?]{0,24}(won'?t|wont|will not|does ?n'?t|cannot|can'?t) (be )?stop",
      "can'?t stop the bleeding",
      'blood (is )?(spurting|gushing|pouring)',
      'haemorrhag(e|ing)',
      'hemorrhag(e|ing)',
      'vomiting blood',
      'coughing up blood',
      'blood in (my |the )?vomit',
    ),
  },
  {
    id: 'allergy.anaphylaxis',
    concern: 'Possible anaphylaxis (severe allergic reaction)',
    patterns: phrases(
      'anaphyla(xis|ctic)',
      'throat (is )?(closing|swelling)',
      'tongue (is )?swelling',
      'face (is )?swelling (and|with)',
      'severe allergic reaction',
      'epipen',
    ),
  },
  {
    id: 'mental_health.self_harm',
    concern: 'Thoughts of suicide or self-harm',
    patterns: phrases(
      'suicid(e|al)',
      'kill myself',
      'end my life',
      'take my own life',
      'want to die',
      "don'?t want to (live|be alive)",
      'hurt myself',
      'harm myself',
      'self.?harm',
      'overdos(e|ed|ing)',
    ),
  },
  {
    id: 'toxic.poisoning',
    concern: 'Poisoning or toxic ingestion',
    patterns: phrases(
      'poison(ed|ing)',
      'swallowed (bleach|acid|chemicals|batteries|pills)',
      'drank (bleach|acid|chemicals)',
      'took too many (pills|tablets)',
      'snake ?bite',
      'venomous bite',
    ),
  },
  {
    id: 'obstetric.emergency',
    concern: 'Pregnancy emergency',
    patterns: phrases(
      'bleeding (heavily )?(while|during) pregnan(t|cy)',
      'pregnant and bleeding',
      'water broke',
      'in labou?r',
      'contractions (every|are)',
      'baby (is )?not moving',
      'no fetal movement',
    ),
  },
  {
    id: 'infection.sepsis',
    concern: 'Signs consistent with sepsis or severe infection',
    patterns: phrases(
      'sepsis',
      'septic',
      'stiff neck (and|with) (fever|rash)',
      'rash (that )?(does ?n.?t|wont|won.?t) fade',
      'non.?blanching rash',
      'very high fever (and|with) confusion',
    ),
  },
  {
    id: 'paediatric.infant_fever',
    concern: 'Fever in a very young infant',
    patterns: phrases(
      '(newborn|infant|baby) (has |with )?(a )?(high )?fever',
      'fever in (a |my )?(newborn|infant|baby under)',
      '(baby|infant|newborn) (is )?(limp|floppy|lethargic)',
      '(baby|infant|newborn) (is )?not feeding',
    ),
  },
  {
    id: 'abdomen.acute',
    concern: 'Acute abdominal emergency',
    patterns: phrases(
      'severe (abdominal|stomach|belly) pain',
      'worst (stomach|abdominal) pain',
      'rigid (abdomen|stomach|belly)',
      'appendicitis',
      'testicular torsion',
      'sudden severe testicular pain',
    ),
  },
  {
    id: 'generic.emergency_language',
    concern: 'Explicitly described as a life-threatening emergency',
    patterns: phrases(
      'life.?threatening',
      'dying',
      'about to die',
      'emergency',
      'call (an )?ambulance',
      'need an ambulance',
    ),
    // "emergency contact", "emergency dentist" etc. are not emergencies.
    suppressIf: [
      /\bemergency\s+(contact|fund|exit|kit|number|dentist|appointment|room hours)\b/i,
      /\b(is it|was it|would (that|it) be|do you think.{0,20})\s+an?\s+emergency\b/i,
    ],
  },
];

/** True when the match at `index` sits inside a negation window. */
function isNegated(message: string, index: number): boolean {
  const before = message.slice(Math.max(0, index - NEGATION_WINDOW), index);
  return NEGATION_PATTERN.test(before);
}

/**
 * Runs every red-flag rule against the message.
 *
 * Returns all matches rather than the first, because the response lists every
 * concern found — a user reporting both chest pain and breathlessness should
 * see both acknowledged.
 */
export function detectRedFlags(rawMessage: string): TriageResult {
  const message = rawMessage.toLowerCase().replace(/[‘’]/g, "'");
  const matches: RedFlagMatch[] = [];

  for (const rule of RED_FLAG_RULES) {
    if (rule.suppressIf?.some((pattern) => pattern.test(message))) continue;

    for (const pattern of rule.patterns) {
      const found = pattern.exec(message);
      if (!found) continue;
      if (isNegated(message, found.index)) continue;

      matches.push({
        ruleId: rule.id,
        concern: rule.concern,
        matchedText: found[0].trim(),
      });
      break; // One match per rule is enough to justify the concern.
    }
  }

  return { isEmergency: matches.length > 0, matches };
}
