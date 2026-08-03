import type { Coordinates } from '@calldoc/shared';

interface Props {
  location: Coordinates | null;
  locationText: string;
  status: 'idle' | 'requesting' | 'error';
  error: string | null;
  onRequestLocation: () => void;
  onLocationTextChange: (value: string) => void;
}

export function LocationBar({
  location,
  locationText,
  status,
  error,
  onRequestLocation,
  onLocationTextChange,
}: Props): JSX.Element {
  return (
    <div className="location">
      {location ? (
        <span className="location__ok">
          Using your location ({location.lat.toFixed(3)}, {location.lon.toFixed(3)})
        </span>
      ) : (
        <>
          <button
            type="button"
            className="button"
            onClick={onRequestLocation}
            disabled={status === 'requesting'}
          >
            {status === 'requesting' ? 'Locating…' : 'Use my location'}
          </button>
          <span className="location__or">or</span>
          <input
            className="location__input"
            type="text"
            placeholder="Type your area, e.g. Salt Lake, Kolkata"
            value={locationText}
            onChange={(event) => onLocationTextChange(event.target.value)}
            aria-label="Your area"
          />
        </>
      )}
      {error && <p className="location__error">{error}</p>}
    </div>
  );
}
