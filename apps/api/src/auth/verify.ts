import { createRemoteJWKSet, jwtVerify } from 'jose';

export interface AuthUser {
  userId: string;
  email: string | null;
  name: string | null;
}

/** Checks a Supabase access token and returns who it belongs to. */
export interface AuthVerifier {
  verify(token: string): Promise<AuthUser>;
}

export class InvalidToken extends Error {}

/**
 * Verifies Supabase access tokens locally against the project's published signing keys (JWKS),
 * so no call to Supabase is needed per request. Keys are fetched once and cached by `jose`.
 */
export function supabaseVerifier(supabaseUrl: string): AuthVerifier {
  const base = supabaseUrl.replace(/\/+$/, '');
  const jwks = createRemoteJWKSet(new URL(`${base}/auth/v1/.well-known/jwks.json`));
  return {
    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, jwks, { issuer: `${base}/auth/v1`, audience: 'authenticated' });
        if (!payload.sub) throw new InvalidToken('Token has no subject.');
        const meta = (payload.user_metadata ?? {}) as Record<string, unknown>;
        const name = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : null;
        return { userId: payload.sub, email: typeof payload.email === 'string' ? payload.email : null, name };
      } catch (err) {
        throw err instanceof InvalidToken ? err : new InvalidToken('Invalid or expired sign-in.');
      }
    },
  };
}
