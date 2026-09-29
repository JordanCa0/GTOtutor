const KEY = 'gtotutor.sessionId';
let fallback: string | null = null;

/** Anonymous per-browser session id; storage can be unavailable, so fall back to memory. */
export function getSessionId(): string {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored) return stored;
  } catch {
    // storage blocked
  }
  return fallback ?? newSessionId();
}

export function newSessionId(): string {
  const id = crypto.randomUUID();
  fallback = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // storage blocked; memory fallback is enough for this tab
  }
  return id;
}
