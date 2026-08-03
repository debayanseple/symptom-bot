import type { Specialty } from './specialties.js';

// --- Geography -------------------------------------------------------------

export interface Coordinates {
  lat: number;
  lon: number;
}

export interface BoundingBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

// --- Triage ----------------------------------------------------------------

/**
 * `emergency` is produced ONLY by the deterministic red-flag layer, never by
 * the LLM. See packages/api/src/triage/redFlags.ts.
 */
export type Urgency = 'emergency' | 'urgent' | 'soon' | 'routine';

export interface RedFlagMatch {
  /** Stable id of the rule that fired, for logging and audit. */
  ruleId: string;
  /** Plain-language description of the concern, shown to the user. */
  concern: string;
  /** The exact phrase from the user's message that triggered the rule. */
  matchedText: string;
}

export interface TriageResult {
  isEmergency: boolean;
  matches: RedFlagMatch[];
}

// --- NLU -------------------------------------------------------------------

export interface SymptomAnalysis {
  specialty: Specialty;
  urgency: Exclude<Urgency, 'emergency'>;
  /** 0–1. Below the config threshold we fall back to general practice. */
  confidence: number;
  /** Normalised symptom phrases extracted from the message. */
  symptoms: string[];
  /** Which layer produced this analysis — useful for evaluating the LLM. */
  source: 'rules' | 'llm' | 'llm+rules' | 'fallback';
}

// --- Facilities ------------------------------------------------------------

export type FacilityType = 'hospital' | 'clinic' | 'doctor' | 'dentist' | 'pharmacy';

export type FacilitySource = 'osm' | 'foursquare' | 'manual';

export interface Facility {
  id: string;
  sourceId: string;
  source: FacilitySource;
  name: string;
  /**
   * The doctor's name, when the facility is recorded under one. OSM has no
   * practitioner roster, so this is only populated for practices named after
   * the doctor who runs them — never a list of staff at a hospital.
   */
  practitioner: string | null;
  type: FacilityType;
  specialtyTags: Specialty[];
  lat: number;
  lon: number;
  address: string | null;
  phone: string | null;
  website: string | null;
  openingHours: string | null;
  emergency: boolean;
  description: string | null;
  lastSyncedAt: string;
}

export interface RankedFacility extends Facility {
  distanceKm: number;
  /** Cosine similarity from pgvector, present only when the RAG layer ran. */
  semanticScore?: number;
  /** Blended distance + semantic + specialty-match score used for ordering. */
  score: number;
  /** Short grounded sentence explaining the match. LLM-written, or templated. */
  reason: string;
}

// --- Chat API contract -----------------------------------------------------

export interface ChatRequest {
  message: string;
  location?: Coordinates;
  /** Free-text place name, used only when `location` is absent. */
  locationText?: string;
  radiusKm?: number;
  sessionId?: string;
}

export interface EmergencyResponse {
  kind: 'emergency';
  concerns: RedFlagMatch[];
  message: string;
  emergencyNumbers: { label: string; number: string }[];
  /** Nearest facilities with an A&E department, if location was provided. */
  nearestEmergency: RankedFacility[];
  disclaimer: string;
}

export interface RecommendationResponse {
  kind: 'recommendation';
  analysis: SymptomAnalysis;
  specialtyLabel: string;
  message: string;
  facilities: RankedFacility[];
  /** True when the radius was widened because the first pass found nothing. */
  radiusExpanded: boolean;
  radiusKm: number;
  disclaimer: string;
}

/** Result of a lookup by facility or doctor name, rather than by symptom. */
export interface DirectoryResponse {
  kind: 'directory';
  query: string;
  message: string;
  facilities: RankedFacility[];
  /** True when the user's location was known and distances are meaningful. */
  hasLocation: boolean;
  disclaimer: string;
}

export interface ClarificationResponse {
  kind: 'clarification';
  message: string;
  /** What the server still needs before it can search. */
  needs: ('location' | 'symptoms')[];
  disclaimer: string;
}

export type ChatResponse =
  | EmergencyResponse
  | RecommendationResponse
  | DirectoryResponse
  | ClarificationResponse;

export const DISCLAIMER =
  'This is not a diagnosis. Call Doc suggests which kind of doctor may be relevant and where to find one nearby — it cannot assess your condition. If you feel your symptoms are severe or worsening, contact emergency services or go to the nearest emergency department.';
