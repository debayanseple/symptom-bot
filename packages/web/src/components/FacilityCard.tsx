import { formatDistance } from '@calldoc/shared';
import type { RankedFacility } from '@calldoc/shared';

const TYPE_LABEL: Record<RankedFacility['type'], string> = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  doctor: "Doctor's practice",
  dentist: 'Dental practice',
  pharmacy: 'Pharmacy',
};

export function FacilityCard({ facility }: { facility: RankedFacility }): JSX.Element {
  const mapsUrl = `https://www.openstreetmap.org/?mlat=${facility.lat}&mlon=${facility.lon}#map=17/${facility.lat}/${facility.lon}`;

  return (
    <article className="facility">
      <header className="facility__header">
        <h3 className="facility__name">{facility.name}</h3>
        <span className="facility__distance">{formatDistance(facility.distanceKm)}</span>
      </header>

      <p className="facility__meta">
        <span className="tag">{TYPE_LABEL[facility.type]}</span>
        {facility.emergency && <span className="tag tag--emergency">Emergency dept.</span>}
        {facility.openingHours === '24/7' && <span className="tag tag--open">Open 24h</span>}
      </p>

      <p className="facility__reason">{facility.reason}</p>

      {facility.address && <p className="facility__address">{facility.address}</p>}
      {facility.openingHours && facility.openingHours !== '24/7' && (
        <p className="facility__hours">Hours: {facility.openingHours}</p>
      )}

      <div className="facility__actions">
        {/* MVP is "find + call to book" — the phone number is the primary action. */}
        {facility.phone ? (
          <a className="button button--primary" href={`tel:${facility.phone}`}>
            Call {facility.phone}
          </a>
        ) : (
          <span className="button button--disabled" aria-disabled="true">
            No phone number listed
          </span>
        )}

        <a className="button" href={mapsUrl} target="_blank" rel="noreferrer noopener">
          View on map
        </a>

        {facility.website && (
          <a className="button" href={facility.website} target="_blank" rel="noreferrer noopener">
            Website
          </a>
        )}
      </div>
    </article>
  );
}
