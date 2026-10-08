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

/** The guided tour runs in two parts: before your first decision, and after your first grade. */
export type TourPart = 'play' | 'verdict';
const tourKey = (part: TourPart) => `gtotutor.seenTour.${part}`;

export function hasSeenTour(part: TourPart): boolean {
  try {
    return localStorage.getItem(tourKey(part)) === '1';
  } catch {
    // Storage blocked: don't show the tour on every hand.
    return true;
  }
}

export function markTourSeen(part: TourPart): void {
  try {
    localStorage.setItem(tourKey(part), '1');
  } catch {
    // storage blocked; nothing to remember
  }
}
