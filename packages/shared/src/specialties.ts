/**
 * The specialty taxonomy is the pivot between three otherwise-unrelated
 * vocabularies: what users type, what OSM tags facilities with, and what the
 * LLM is allowed to emit. Every one of those mappings lives here so they can
 * never drift apart.
 */

export const SPECIALTIES = [
  'general_practice',
  'cardiology',
  'dermatology',
  'orthopaedics',
  'neurology',
  'gastroenterology',
  'pulmonology',
  'ent',
  'ophthalmology',
  'dentistry',
  'gynaecology',
  'paediatrics',
  'psychiatry',
  'urology',
  'endocrinology',
  'rheumatology',
  'nephrology',
  'oncology',
  'emergency',
] as const;

export type Specialty = (typeof SPECIALTIES)[number];

export function isSpecialty(value: unknown): value is Specialty {
  return typeof value === 'string' && (SPECIALTIES as readonly string[]).includes(value);
}

export interface SpecialtyMeta {
  /** Human-facing label used in chat copy. */
  label: string;
  /** One-line explanation of what this specialty treats. */
  blurb: string;
  /**
   * Values seen in OSM `healthcare:speciality` (British spelling, semicolon
   * separated in the raw tag). Matched case-insensitively as substrings.
   */
  osmSpecialities: string[];
}

export const SPECIALTY_META: Record<Specialty, SpecialtyMeta> = {
  general_practice: {
    label: 'General Practice',
    blurb: 'First point of contact for undifferentiated or mild symptoms.',
    osmSpecialities: ['general', 'general_practitioner', 'family_medicine', 'internal_medicine'],
  },
  cardiology: {
    label: 'Cardiology',
    blurb: 'Heart and circulatory conditions.',
    osmSpecialities: ['cardiology', 'cardiac_surgery', 'cardiothoracic_surgery', 'vascular_surgery'],
  },
  dermatology: {
    label: 'Dermatology',
    blurb: 'Skin, hair and nail conditions.',
    osmSpecialities: ['dermatology', 'dermatovenerology'],
  },
  orthopaedics: {
    label: 'Orthopaedics',
    blurb: 'Bones, joints, ligaments and musculoskeletal injuries.',
    osmSpecialities: ['orthopaedics', 'orthopedics', 'traumatology', 'sports_medicine', 'physiotherapy', 'osteoarthritis'],
  },
  neurology: {
    label: 'Neurology',
    blurb: 'Brain, spinal cord and nerve disorders.',
    osmSpecialities: ['neurology', 'neurosurgery', 'stroke_rehab'],
  },
  gastroenterology: {
    label: 'Gastroenterology',
    blurb: 'Digestive tract, liver and pancreas.',
    osmSpecialities: ['gastroenterology', 'hepatology', 'proctology'],
  },
  pulmonology: {
    label: 'Pulmonology',
    blurb: 'Lungs and breathing.',
    osmSpecialities: ['pulmonology', 'respiratory', 'phthisiology'],
  },
  ent: {
    label: 'ENT (Otolaryngology)',
    blurb: 'Ear, nose, throat, sinuses and voice.',
    osmSpecialities: ['otolaryngology', 'ent', 'audiology'],
  },
  ophthalmology: {
    label: 'Ophthalmology',
    blurb: 'Eyes and vision.',
    osmSpecialities: ['ophthalmology', 'optometry'],
  },
  dentistry: {
    label: 'Dentistry',
    blurb: 'Teeth, gums and oral health.',
    osmSpecialities: ['dentist', 'dentistry', 'orthodontics', 'oral_surgery', 'dental_oral_maxillo_facial_surgery'],
  },
  gynaecology: {
    label: 'Gynaecology & Obstetrics',
    blurb: 'Reproductive health, pregnancy and childbirth.',
    osmSpecialities: ['gynaecology', 'gynecology', 'obstetrics', 'maternity', 'fertility'],
  },
  paediatrics: {
    label: 'Paediatrics',
    blurb: 'Medical care for infants, children and adolescents.',
    osmSpecialities: ['paediatrics', 'pediatrics', 'neonatology', 'paediatric_surgery', 'pediatric_surgery'],
  },
  psychiatry: {
    label: 'Psychiatry & Mental Health',
    blurb: 'Mental health, mood, anxiety and behavioural conditions.',
    osmSpecialities: ['psychiatry', 'psychotherapy', 'psychology', 'child_psychiatry'],
  },
  urology: {
    label: 'Urology',
    blurb: 'Urinary tract and male reproductive system.',
    osmSpecialities: ['urology', 'andrology', 'nephrology'],
  },
  endocrinology: {
    label: 'Endocrinology',
    blurb: 'Hormones, diabetes, thyroid and metabolism.',
    osmSpecialities: ['endocrinology', 'diabetology'],
  },
  rheumatology: {
    label: 'Rheumatology',
    blurb: 'Autoimmune and inflammatory joint conditions.',
    osmSpecialities: ['rheumatology', 'immunology'],
  },
  nephrology: {
    label: 'Nephrology',
    blurb: 'Kidney function and dialysis.',
    osmSpecialities: ['nephrology', 'dialysis'],
  },
  oncology: {
    label: 'Oncology',
    blurb: 'Cancer diagnosis and treatment.',
    osmSpecialities: ['oncology', 'radiotherapy', 'haematology'],
  },
  emergency: {
    label: 'Emergency Medicine',
    blurb: 'Immediate care for acute, potentially life-threatening problems.',
    osmSpecialities: ['emergency', 'intensive_care'],
  },
};

export function specialtyLabel(specialty: Specialty): string {
  return SPECIALTY_META[specialty].label;
}

/**
 * Reverse index: OSM speciality token -> our Specialty. Built once at module
 * load so ingestion can classify thousands of facilities without rescanning.
 */
export const OSM_SPECIALITY_INDEX: ReadonlyMap<string, Specialty> = (() => {
  const index = new Map<string, Specialty>();
  for (const specialty of SPECIALTIES) {
    for (const token of SPECIALTY_META[specialty].osmSpecialities) {
      // First writer wins — order in SPECIALTIES defines precedence for tokens
      // that legitimately belong to two specialties (e.g. `nephrology`).
      if (!index.has(token)) index.set(token, specialty);
    }
  }
  return index;
})();
