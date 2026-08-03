import type { Specialty } from '@calldoc/shared';

/**
 * Rule-based symptom -> specialty mapping. This is the MVP classifier and
 * stays in place permanently as the LLM's safety net: when Ollama is down,
 * slow, or returns junk, this still produces a sane answer.
 *
 * Scoring is intentionally simple — each matched keyword adds its weight to
 * the specialty's tally, highest tally wins. Weights encode specificity:
 * "chest palpitations" is worth more to cardiology than "tired" is to
 * anything.
 */
export interface SymptomRule {
  specialty: Specialty;
  /** Lowercase substrings; matched with word boundaries. */
  keywords: string[];
  weight: number;
}

export const SYMPTOM_RULES: SymptomRule[] = [
  // --- Cardiology
  { specialty: 'cardiology', weight: 3, keywords: ['palpitation', 'heart racing', 'racing heart', 'irregular heartbeat', 'skipped beat', 'angina', 'high blood pressure', 'hypertension', 'heart murmur', 'cholesterol'] },
  { specialty: 'cardiology', weight: 2, keywords: ['swollen ankles', 'swelling in legs', 'breathless when walking', 'chest discomfort'] },

  // --- Dermatology
  { specialty: 'dermatology', weight: 3, keywords: ['rash', 'acne', 'eczema', 'psoriasis', 'mole', 'hives', 'itchy skin', 'skin infection', 'hair loss', 'baldness', 'dandruff', 'wart', 'fungal infection', 'ringworm', 'vitiligo'] },
  { specialty: 'dermatology', weight: 2, keywords: ['dry skin', 'skin peeling', 'nail', 'boil', 'pigmentation'] },

  // --- Orthopaedics
  { specialty: 'orthopaedics', weight: 3, keywords: ['fracture', 'broken bone', 'sprain', 'dislocated', 'torn ligament', 'acl', 'meniscus', 'slipped disc', 'sciatica', 'frozen shoulder', 'tennis elbow'] },
  { specialty: 'orthopaedics', weight: 2, keywords: ['knee pain', 'back pain', 'shoulder pain', 'joint pain', 'hip pain', 'ankle pain', 'neck pain', 'wrist pain', 'muscle pain', 'sports injury', 'limping'] },

  // --- Neurology
  { specialty: 'neurology', weight: 3, keywords: ['migraine', 'epilepsy', 'tremor', 'parkinson', 'multiple sclerosis', 'neuropathy', 'nerve pain', 'memory loss', 'dementia', 'vertigo'] },
  { specialty: 'neurology', weight: 2, keywords: ['headache', 'dizziness', 'dizzy', 'tingling', 'numbness', 'pins and needles', 'fainting spells'] },

  // --- Gastroenterology
  { specialty: 'gastroenterology', weight: 3, keywords: ['acid reflux', 'gerd', 'heartburn', 'ulcer', 'ibs', 'irritable bowel', 'crohn', 'colitis', 'jaundice', 'liver', 'gallstone', 'piles', 'haemorrhoid', 'hemorrhoid', 'constipation', 'diarrhoea', 'diarrhea'] },
  { specialty: 'gastroenterology', weight: 2, keywords: ['stomach pain', 'abdominal pain', 'bloating', 'indigestion', 'nausea', 'vomiting', 'loss of appetite', 'gas'] },

  // --- Pulmonology
  { specialty: 'pulmonology', weight: 3, keywords: ['asthma', 'copd', 'tuberculosis', 'pneumonia', 'bronchitis', 'wheezing', 'chronic cough', 'sleep apnea', 'sleep apnoea'] },
  { specialty: 'pulmonology', weight: 2, keywords: ['cough', 'shortness of breath', 'breathless', 'phlegm', 'chest congestion'] },

  // --- ENT
  { specialty: 'ent', weight: 3, keywords: ['ear pain', 'earache', 'hearing loss', 'tinnitus', 'ringing in ears', 'sinusitis', 'sinus', 'tonsil', 'hoarse', 'nosebleed', 'blocked nose', 'deviated septum', 'snoring'] },
  { specialty: 'ent', weight: 2, keywords: ['sore throat', 'throat pain', 'runny nose', 'ear infection', 'difficulty swallowing'] },

  // --- Ophthalmology
  { specialty: 'ophthalmology', weight: 3, keywords: ['blurred vision', 'blurry vision', 'cataract', 'glaucoma', 'conjunctivitis', 'pink eye', 'double vision', 'eye pain', 'floaters', 'stye'] },
  { specialty: 'ophthalmology', weight: 2, keywords: ['red eye', 'watery eyes', 'itchy eyes', 'vision', 'spectacle', 'eye strain'] },

  // --- Dentistry
  { specialty: 'dentistry', weight: 3, keywords: ['toothache', 'tooth pain', 'cavity', 'gum bleeding', 'bleeding gums', 'wisdom tooth', 'root canal', 'braces', 'dental', 'plaque', 'tooth sensitivity'] },
  // Plain "tooth"/"gum" catch the many phrasings that never use the compound
  // words above ("my tooth has been aching", "my gums hurt").
  { specialty: 'dentistry', weight: 2, keywords: ['tooth', 'gum', 'jaw pain', 'bad breath', 'mouth ulcer', 'filling'] },

  // --- Gynaecology
  { specialty: 'gynaecology', weight: 3, keywords: ['period pain', 'irregular periods', 'menstrual', 'pcos', 'pcod', 'endometriosis', 'pregnan', 'menopause', 'vaginal', 'fibroid', 'infertility', 'contraception', 'pap smear'] },
  { specialty: 'gynaecology', weight: 2, keywords: ['pelvic pain', 'missed period', 'breast lump'] },

  // --- Paediatrics
  { specialty: 'paediatrics', weight: 3, keywords: ['my child', 'my son', 'my daughter', 'my baby', 'my toddler', 'newborn', 'infant', 'vaccination schedule', 'immunisation', 'immunization', 'growth chart'] },
  { specialty: 'paediatrics', weight: 2, keywords: ['child', 'kid', 'baby', 'teething', 'colic'] },

  // --- Psychiatry
  { specialty: 'psychiatry', weight: 3, keywords: ['depress', 'anxiety', 'panic attack', 'bipolar', 'ocd', 'ptsd', 'adhd', 'schizophrenia', 'eating disorder', 'anorexia', 'bulimia', 'addiction', 'therapy', 'counsel'] },
  { specialty: 'psychiatry', weight: 2, keywords: ['insomnia', "can't sleep", 'cant sleep', 'stressed', 'mood swings', 'hopeless', 'overwhelmed'] },

  // --- Urology
  { specialty: 'urology', weight: 3, keywords: ['urinary tract infection', 'uti', 'kidney stone', 'prostate', 'erectile', 'blood in urine', 'incontinence', 'painful urination'] },
  { specialty: 'urology', weight: 2, keywords: ['burning when i pee', 'frequent urination', 'urine', 'bladder'] },

  // --- Endocrinology
  { specialty: 'endocrinology', weight: 3, keywords: ['diabet', 'thyroid', 'hypothyroid', 'hyperthyroid', 'blood sugar', 'insulin', 'hormone imbalance', 'obesity'] },
  { specialty: 'endocrinology', weight: 2, keywords: ['excessive thirst', 'sudden weight gain', 'sudden weight loss', 'always tired'] },

  // --- Rheumatology
  { specialty: 'rheumatology', weight: 3, keywords: ['arthritis', 'rheumatoid', 'lupus', 'gout', 'fibromyalgia', 'ankylosing spondylitis', 'autoimmune'] },
  { specialty: 'rheumatology', weight: 2, keywords: ['morning stiffness', 'swollen joints', 'multiple joints'] },

  // --- Nephrology
  { specialty: 'nephrology', weight: 3, keywords: ['kidney disease', 'kidney failure', 'dialysis', 'creatinine', 'nephritis', 'protein in urine'] },

  // --- Oncology
  { specialty: 'oncology', weight: 3, keywords: ['cancer', 'tumour', 'tumor', 'chemotherapy', 'lymphoma', 'leukemia', 'leukaemia', 'biopsy', 'malignant'] },
  { specialty: 'oncology', weight: 2, keywords: ['lump that is growing', 'unexplained weight loss'] },

  // --- General practice (deliberate low weights: the default catch-all)
  { specialty: 'general_practice', weight: 2, keywords: ['fever', 'flu', 'cold', 'body ache', 'weakness', 'fatigue', 'general checkup', 'health checkup', 'blood test', 'not feeling well', 'unwell', 'viral'] },
];

/**
 * Words people use to say something is wrong. Kept separate from body parts so
 * the two combine freely: enumerating whole phrases meant "tooth pain" matched
 * while "teeth pain", "my teeth hurt" and "sore teeth" all scored zero and fell
 * through to general practice.
 */
export const SYMPTOM_EXPRESSIONS = [
  'pain', 'pains', 'paining', 'painful', 'ache', 'aches', 'aching', 'achy',
  'hurt', 'hurts', 'hurting', 'sore', 'soreness', 'discomfort',
  'swollen', 'swelling', 'burning', 'itchy', 'itching', 'itches',
  'sensitive', 'sensitivity', 'bleeding', 'stiff', 'stiffness',
  'numb', 'numbness', 'cramp', 'cramps', 'infection', 'infected',
  'problem', 'problems', 'issue', 'issues', 'trouble', 'weak', 'weakness',
  'irritation', 'irritated', 'discharge', 'rash', 'lump', 'injury', 'injured',
];

export interface BodyPartRule {
  specialty: Specialty;
  /** Whole words, so 'ear' cannot match 'early'. Plurals listed explicitly. */
  parts: string[];
  weight: number;
  /**
   * When false the part only counts if the message also carries a symptom
   * word — 'back' and 'head' are far too common in ordinary English to imply
   * a complaint on their own.
   */
  standalone: boolean;
}

export const BODY_PART_RULES: BodyPartRule[] = [
  { specialty: 'dentistry', weight: 3, standalone: true,
    parts: ['tooth', 'teeth', 'gum', 'gums', 'molar', 'molars', 'dentures'] },
  { specialty: 'ophthalmology', weight: 3, standalone: true,
    parts: ['eye', 'eyes', 'eyelid', 'eyelids', 'eyesight', 'eyeball'] },
  { specialty: 'ent', weight: 3, standalone: true,
    parts: ['ear', 'ears', 'throat', 'tonsil', 'tonsils', 'sinus', 'sinuses', 'nostril', 'nostrils'] },
  { specialty: 'ent', weight: 2, standalone: false, parts: ['nose'] },
  { specialty: 'orthopaedics', weight: 3, standalone: true,
    parts: ['knee', 'knees', 'ankle', 'ankles', 'elbow', 'elbows', 'wrist', 'wrists',
            'shoulder', 'shoulders', 'joint', 'joints', 'spine', 'heel', 'heels'] },
  { specialty: 'orthopaedics', weight: 2, standalone: false,
    parts: ['back', 'hip', 'hips', 'bone', 'bones', 'muscle', 'muscles', 'leg', 'legs', 'arm', 'arms'] },
  { specialty: 'gastroenterology', weight: 3, standalone: true,
    parts: ['stomach', 'tummy', 'belly', 'abdomen', 'abdominal', 'bowel', 'bowels', 'intestine', 'intestines'] },
  { specialty: 'dermatology', weight: 3, standalone: true,
    parts: ['skin', 'scalp'] },
  { specialty: 'dermatology', weight: 2, standalone: false, parts: ['nail', 'nails'] },
  { specialty: 'neurology', weight: 2, standalone: false, parts: ['head', 'nerve', 'nerves'] },
  { specialty: 'urology', weight: 3, standalone: true,
    parts: ['bladder', 'urine', 'urination', 'testicle', 'testicles'] },
  { specialty: 'gynaecology', weight: 3, standalone: true,
    parts: ['period', 'periods', 'vagina', 'vaginal', 'uterus', 'ovary', 'ovaries', 'breast', 'breasts'] },
  { specialty: 'pulmonology', weight: 3, standalone: true,
    parts: ['lung', 'lungs', 'breathing'] },
  { specialty: 'nephrology', weight: 3, standalone: true, parts: ['kidney', 'kidneys'] },
];

export interface RuleClassification {
  specialty: Specialty;
  confidence: number;
  matchedSymptoms: string[];
  /** All specialties that scored, highest first — useful for logging. */
  ranking: { specialty: Specialty; score: number }[];
}

function matches(message: string, keyword: string): boolean {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Keywords are stems in some cases ("depress", "pregnan"), so only the left
  // edge is anchored.
  return new RegExp(`(?<![a-z])${escaped}`, 'i').test(message);
}

/**
 * Whole-word match, both edges anchored. Body parts need this: a left-anchored
 * 'ear' happily matches 'early', which would route anyone mentioning an early
 * morning headache to an ENT clinic.
 */
function matchesWord(message: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z])${escaped}(?![a-z])`, 'i').test(message);
}

export function classifyByRules(rawMessage: string): RuleClassification {
  const message = rawMessage.toLowerCase().replace(/[‘’]/g, "'");
  const scores = new Map<Specialty, number>();
  const matched: string[] = [];

  for (const rule of SYMPTOM_RULES) {
    for (const keyword of rule.keywords) {
      if (!matches(message, keyword)) continue;
      scores.set(rule.specialty, (scores.get(rule.specialty) ?? 0) + rule.weight);
      matched.push(keyword);
    }
  }

  // Body part + symptom word, scored independently of the phrase list above.
  const hasSymptomWord = SYMPTOM_EXPRESSIONS.some((w) => matchesWord(message, w));
  for (const rule of BODY_PART_RULES) {
    if (!rule.standalone && !hasSymptomWord) continue;
    for (const part of rule.parts) {
      if (!matchesWord(message, part)) continue;
      scores.set(rule.specialty, (scores.get(rule.specialty) ?? 0) + rule.weight);
      matched.push(part);
      // One hit per rule: "my knees and ankles hurt" is one orthopaedic
      // complaint, not two, and shouldn't outscore a specific diagnosis.
      break;
    }
  }

  const ranking = [...scores.entries()]
    .map(([specialty, score]) => ({ specialty, score }))
    .sort((a, b) => b.score - a.score);

  const top = ranking[0];
  if (!top) {
    return {
      specialty: 'general_practice',
      confidence: 0.2,
      matchedSymptoms: [],
      ranking: [],
    };
  }

  // Confidence rises with the winner's score and with how clearly it beats the
  // runner-up. A message hitting two specialties equally is genuinely ambiguous.
  const runnerUp = ranking[1]?.score ?? 0;
  const total = ranking.reduce((sum, r) => sum + r.score, 0);
  const dominance = top.score / Math.max(1, total);
  const separation = (top.score - runnerUp) / Math.max(1, top.score);
  const strength = Math.min(1, top.score / 6);
  const confidence = Number((0.35 * strength + 0.35 * dominance + 0.3 * separation).toFixed(3));

  return {
    specialty: top.specialty,
    confidence,
    matchedSymptoms: [...new Set(matched)],
    ranking,
  };
}
