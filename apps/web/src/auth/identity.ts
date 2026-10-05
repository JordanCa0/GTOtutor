const KEY = 'gtotutor.guestId';
let fallback: string | null = null;

/**
 * This browser's guest id, sent as X-Guest-Id so the API knows whose hands are whose. Guest data
 * lasts one session; signing in moves it to the account, and a fresh guest id starts after.
 */
export function getGuestId(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;
  } catch {
    // storage blocked; fall back to memory
  }
  return fallback ?? resetGuestId();
}

export function resetGuestId(): string {
  const id = crypto.randomUUID();
  fallback = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // storage blocked; memory fallback is enough for this tab
  }
  return id;
}
