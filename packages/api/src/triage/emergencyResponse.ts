import { DISCLAIMER } from '@calldoc/shared';
import type { EmergencyResponse, RankedFacility, TriageResult } from '@calldoc/shared';

/**
 * Emergency numbers shown when the red-flag layer fires. India-first because
 * the MVP launches in Kolkata; add entries as coverage expands. These are
 * static and deliberately not LLM-generated.
 */
export const EMERGENCY_NUMBERS = [
  { label: 'All-in-one emergency', number: '112' },
  { label: 'Ambulance', number: '108' },
  { label: 'Medical helpline', number: '102' },
  { label: 'Mental health helpline (Tele-MANAS)', number: '14416' },
] as const;

export function buildEmergencyResponse(
  triage: TriageResult,
  nearestEmergency: RankedFacility[],
): EmergencyResponse {
  const concernList = triage.matches.map((m) => m.concern.toLowerCase());
  const summary =
    concernList.length === 1
      ? concernList[0]
      : `${concernList.slice(0, -1).join('; ')}; and ${concernList.at(-1)}`;

  const message = [
    'What you have described may need emergency care right now, not an appointment.',
    `Reason: ${summary}.`,
    'Please call an emergency number or go to the nearest emergency department immediately. If you are with someone who is unresponsive or not breathing, call first and stay with them.',
  ].join('\n\n');

  return {
    kind: 'emergency',
    concerns: triage.matches,
    message,
    emergencyNumbers: [...EMERGENCY_NUMBERS],
    nearestEmergency,
    disclaimer: DISCLAIMER,
  };
}
