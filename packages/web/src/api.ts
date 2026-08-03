import type { ChatRequest, ChatResponse, Coordinates } from '@calldoc/shared';

const BASE = import.meta.env.VITE_API_URL ?? '';

export async function sendChat(request: ChatRequest): Promise<ChatResponse> {
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `Request failed (${response.status})`);
  }

  return (await response.json()) as ChatResponse;
}

/**
 * Browser Geolocation API — free, client-side, no server round trip and no
 * geocoding quota (PRD section 3).
 */
export function requestBrowserLocation(): Promise<Coordinates> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This browser does not support location sharing.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({ lat: position.coords.latitude, lon: position.coords.longitude }),
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied. You can type your area instead.'
            : 'Could not get your location. You can type your area instead.';
        reject(new Error(message));
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    );
  });
}
