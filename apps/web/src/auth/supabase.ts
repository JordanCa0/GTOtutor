import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * A failed sign-in (e.g. Google → Supabase hand-off) comes back as ?error_description=… or
 * #error_description=… on our URL. Read it before the Supabase client looks at the URL, then
 * remove those parameters so a reload doesn't show it again.
 */
function takeAuthError(): string | null {
  if (typeof window === 'undefined') return null;
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const pick = (k: string) => query.get(k) ?? hash.get(k);
  const message = pick('error_description') ?? pick('error_code') ?? pick('error');
  if (!message) return null;
  for (const k of ['error', 'error_code', 'error_description']) {
    query.delete(k);
    hash.delete(k);
  }
  const clean = `${window.location.pathname}${query.size ? `?${query}` : ''}${hash.size ? `#${hash}` : ''}`;
  window.history.replaceState(null, '', clean);
  return message.replace(/\+/g, ' ');
}

/** Returned from Google with a one-time code: if no session comes of it, the sign-in failed. */
export const initialHadCode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('code');
export const initialAuthError = takeAuthError();

/**
 * Supabase is used in the browser only for signing in (the API reads and writes all data).
 * Without the settings in apps/web/.env.local, sign-in is hidden and everyone plays as a guest.
 */
export const supabase = url && key ? createClient(url, key, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
