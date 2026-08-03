import type { EmergencyResponse } from '@calldoc/shared';
import { FacilityCard } from './FacilityCard.tsx';

/**
 * Rendered when the deterministic triage layer fires. Visually distinct from
 * every other response on purpose — this is the one message the user must not
 * skim past.
 */
export function EmergencyPanel({ response }: { response: EmergencyResponse }): JSX.Element {
  return (
    <section className="emergency" role="alert" aria-live="assertive">
      <h2 className="emergency__title">This may need emergency care</h2>

      <div className="emergency__body">
        {response.message.split('\n\n').map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      <ul className="emergency__numbers">
        {response.emergencyNumbers.map((entry) => (
          <li key={entry.number}>
            <a className="button button--emergency" href={`tel:${entry.number}`}>
              {entry.label}: {entry.number}
            </a>
          </li>
        ))}
      </ul>

      {response.nearestEmergency.length > 0 && (
        <>
          <h3 className="emergency__subtitle">Nearest emergency departments</h3>
          <div className="facility-list">
            {response.nearestEmergency.map((facility) => (
              <FacilityCard key={facility.id} facility={facility} />
            ))}
          </div>
        </>
      )}

      <details className="emergency__why">
        <summary>Why this warning appeared</summary>
        <ul>
          {response.concerns.map((concern) => (
            <li key={concern.ruleId}>
              {concern.concern} — matched &ldquo;{concern.matchedText}&rdquo;
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
