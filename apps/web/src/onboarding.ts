const KEY = 'gtotutor.seenTitle';

/** Whether this browser has already been past the title screen; storage can be unavailable, so treat that as a first visit. */
export function hasSeenTitle(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markTitleSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // storage blocked; the title shows again next load
  }
}
