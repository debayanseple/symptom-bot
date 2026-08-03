import { formatDistance } from '@calldoc/shared';
import type { RankedFacility } from '@calldoc/shared';

const TYPE_LABEL: Record<RankedFacility['type'], string> = {
  hospital: 'Hospital',
  clinic: 'Clinic',
  doctor: "Doctor's practice",
  dentist: 'Dental practice',
  pharmacy: 'Pharmacy',
};

interface Props {
  facility: RankedFacility;
  /** Hidden for name searches made before the user shared a location. */
  showDistance?: boolean;
}

export function FacilityCard({ facility, showDistance = true }: Props): JSX.Element {
  // Ratings only exist on live Google results, never on stored OSM records.
  const { rating, ratingCount } = facility as RankedFacility & {
    rating?: number;
    ratingCount?: number;
  };

  const mapsUrl =
    facility.source === 'google'
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(facility.name)}&query_place_id=${facility.sourceId}`
      : `https://www.openstreetmap.org/?mlat=${facility.lat}&mlon=${facility.lon}#map=17/${facility.lat}/${facility.lon}`;

  return (
    <article className="facility">
      <header className="facility__header">
        <div className="facility__titles">
          {/* When OSM records the practice under a doctor's name, lead with the
              person — that is what someone asking for "a doctor" wants to see. */}
          {facility.practitioner ? (
            <>
              <h3 className="facility__name">{facility.practitioner}</h3>
              <p className="facility__at">{facility.name}</p>
            </>
          ) : (
            <h3 className="facility__name">{facility.name}</h3>
          )}
        </div>
        {showDistance && (
          <span className="facility__distance">{formatDistance(facility.distanceKm)}</span>
        )}
      </header>

      <p className="facility__meta">
        {facility.practitioner && <span className="tag tag--doctor">Named doctor</span>}
        <span className="tag">{TYPE_LABEL[facility.type]}</span>
        {facility.source === 'google' && <span className="tag tag--google">Google</span>}
        {typeof rating === 'number' && (
          <span className="tag tag--rating">
            ★ {rating.toFixed(1)}
            {typeof ratingCount === 'number' ? ` (${ratingCount})` : ''}
          </span>
        )}
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
