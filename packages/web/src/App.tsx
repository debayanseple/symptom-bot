import { useRef, useState } from 'react';
import { DISCLAIMER } from '@calldoc/shared';
import type { ChatResponse, Coordinates } from '@calldoc/shared';
import { requestBrowserLocation, sendChat } from './api.ts';
import { EmergencyPanel } from './components/EmergencyPanel.tsx';
import { FacilityCard } from './components/FacilityCard.tsx';
import { LocationBar } from './components/LocationBar.tsx';

interface Turn {
  id: number;
  userMessage: string;
  response: ChatResponse | null;
  error: string | null;
}

const EXAMPLES = [
  'itchy rash on my arm for a week',
  'teeth pain on the lower left side',
  'knee pain when I climb stairs',
  // Name lookups work too, and without needing a location.
  'Ruby General Hospital',
  'Dr Chopra',
];

export function App(): JSX.Element {
  const [message, setMessage] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState(false);

  const [location, setLocation] = useState<Coordinates | null>(null);
  const [locationText, setLocationText] = useState('');
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'error'>('idle');
  const [locationError, setLocationError] = useState<string | null>(null);

  const nextId = useRef(1);

  const handleLocationRequest = async (): Promise<void> => {
    setLocationStatus('requesting');
    setLocationError(null);
    try {
      setLocation(await requestBrowserLocation());
      setLocationStatus('idle');
    } catch (error) {
      setLocationStatus('error');
      setLocationError(error instanceof Error ? error.message : String(error));
    }
  };

  const submit = async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || pending) return;

    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, userMessage: trimmed, response: null, error: null }]);
    setMessage('');
    setPending(true);

    try {
      const response = await sendChat({
        message: trimmed,
        ...(location ? { location } : {}),
        ...(!location && locationText.trim() ? { locationText: locationText.trim() } : {}),
      });
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, response } : turn)));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setTurns((prev) => prev.map((turn) => (turn.id === id ? { ...turn, error: detail } : turn)));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Call Doc</h1>
        <p className="app__tagline">
          Describe what you are feeling. We suggest the right kind of doctor and find real ones
          nearby that you can call.
        </p>
      </header>

      <p className="disclaimer disclaimer--top">{DISCLAIMER}</p>

      <LocationBar
        location={location}
        locationText={locationText}
        status={locationStatus}
        error={locationError}
        onRequestLocation={() => void handleLocationRequest()}
        onLocationTextChange={setLocationText}
      />

      <main className="conversation">
        {turns.length === 0 && (
          <div className="examples">
            <p className="examples__label">
              Describe a symptom, or search for a doctor or hospital by name:
            </p>
            <ul className="examples__list">
              {EXAMPLES.map((example) => (
                <li key={example}>
                  <button type="button" className="chip" onClick={() => void submit(example)}>
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {turns.map((turn) => (
          <div className="turn" key={turn.id}>
            <p className="bubble bubble--user">{turn.userMessage}</p>

            {turn.error && <p className="bubble bubble--error">{turn.error}</p>}

            {!turn.response && !turn.error && (
              <p className="bubble bubble--bot bubble--pending">Looking that up…</p>
            )}

            {turn.response?.kind === 'emergency' && <EmergencyPanel response={turn.response} />}

            {turn.response?.kind === 'clarification' && (
              <p className="bubble bubble--bot">{turn.response.message}</p>
            )}

            {turn.response?.kind === 'directory' && (
              <div className="bubble bubble--bot">
                <p className="recommendation__specialty">
                  Search results for <strong>{turn.response.query}</strong>
                </p>
                <p>{turn.response.message}</p>
                <div className="facility-list">
                  {turn.response.facilities.map((facility) => (
                    <FacilityCard
                      key={facility.id}
                      facility={facility}
                      showDistance={turn.response?.kind === 'directory' && turn.response.hasLocation}
                    />
                  ))}
                </div>
              </div>
            )}

            {turn.response?.kind === 'recommendation' && (
              <div className="bubble bubble--bot">
                <p className="recommendation__specialty">
                  Suggested: <strong>{turn.response.specialtyLabel}</strong>
                </p>
                <p>{turn.response.message}</p>

                {turn.response.radiusExpanded && (
                  <p className="recommendation__note">
                    Nothing matched close by, so the search was widened to{' '}
                    {turn.response.radiusKm} km.
                  </p>
                )}

                {turn.response.facilities.length > 0 ? (
                  <div className="facility-list">
                    {turn.response.facilities.map((facility) => (
                      <FacilityCard key={facility.id} facility={facility} />
                    ))}
                  </div>
                ) : (
                  <p className="recommendation__note">
                    No matching facility was found in the area covered so far. Coverage is
                    currently limited to selected cities.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </main>

      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(message);
        }}
      >
        <label className="visually-hidden" htmlFor="symptom-input">
          Describe your symptoms
        </label>
        <textarea
          id="symptom-input"
          className="composer__input"
          rows={2}
          value={message}
          placeholder="Describe your symptoms…"
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit(message);
            }
          }}
        />
        <button type="submit" className="button button--primary" disabled={pending || !message.trim()}>
          {pending ? 'Thinking…' : 'Send'}
        </button>
      </form>

      <footer className="app__footer">
        <p>
          Facility data from{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer noopener">
            OpenStreetMap contributors
          </a>
          , licensed under ODbL.
        </p>
        <p className="disclaimer">{DISCLAIMER}</p>
      </footer>
    </div>
  );
}
