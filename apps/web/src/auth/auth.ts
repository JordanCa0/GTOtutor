import type { Session } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { getGuestId, resetGuestId } from './identity';
import { initialAuthError, initialHadCode, supabase } from './supabase';

export interface AuthState {
  /** Sign-in is configured for this build. */
  enabled: boolean;
  /** False until the stored session (if any) has been read. */
  ready: boolean;
  session: Session | null;
  /** Why the last sign-in attempt failed (shown until dismissed). */
  error: string | null;
}

let state: AuthState = { enabled: !!supabase, ready: !supabase, session: null, error: initialAuthError };
const listeners = new Set<() => void>();
const set = (patch: Partial<AuthState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

/** The current access token for API calls, if signed in. */
export const accessToken = () => state.session?.access_token ?? null;

/** Moves this browser's guest hands into the account, then starts a fresh guest id. */
async function claimGuestData(token: string): Promise<void> {
  const guestId = getGuestId();
  const res = await fetch('/api/me/claim-guest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ guestId }),
  });
  if (res.ok) resetGuestId();
}

if (supabase) {
  supabase.auth.onAuthStateChange((event, session) => {
    const wasSignedIn = !!state.session;
    set({ session, ready: true });
    if (event === 'INITIAL_SESSION' && !session && initialHadCode && !state.error) {
      set({ error: "Sign-in didn't finish: the code from Google couldn't be exchanged for a session. Try again in the same browser tab." });
    }
    // Run outside the callback: Supabase recommends not awaiting other work inside it.
    if (session && !wasSignedIn) setTimeout(() => void claimGuestData(session.access_token), 0);
    if (!session && wasSignedIn) resetGuestId();
  });
}

/** Starts the Google OAuth redirect; the page comes back signed in. */
export function signInWithGoogle() {
  return supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
}

export function dismissAuthError(): void {
  set({ error: null });
}

export function useAuth(): AuthState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

/** Display name for the signed-in user: their name from Google, else their email. */
export function displayName(session: Session): string {
  const meta = session.user.user_metadata ?? {};
  return (meta.full_name as string) || (meta.name as string) || session.user.email || 'Account';
}
