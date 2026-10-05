import type { FastifyRequest } from 'fastify';
import type { Player, Repo } from '../db/repo.js';
import { HttpError } from '../engine/handEngine.js';
import { InvalidToken, type AuthUser, type AuthVerifier } from './verify.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Works out who is making a request: a signed-in user (Authorization: Bearer <Supabase token>)
 * or a guest (X-Guest-Id: <uuid the browser keeps>). Creates the profile row the first time a
 * user is seen.
 */
export class PlayerResolver {
  private readonly knownUsers = new Set<string>();

  constructor(
    private readonly verifier: AuthVerifier | null,
    private readonly repo: Repo,
  ) {}

  /** The signed-in user, or null when the request has no token. */
  async user(req: FastifyRequest): Promise<AuthUser | null> {
    const header = req.headers.authorization;
    if (!header) return null;
    const token = /^Bearer (.+)$/.exec(header)?.[1];
    if (!token) throw new HttpError(401, 'Malformed Authorization header.');
    if (!this.verifier) throw new HttpError(401, 'Sign-in is not configured on this server.');
    try {
      const user = await this.verifier.verify(token);
      if (!this.knownUsers.has(user.userId)) {
        await this.repo.ensureProfile(user.userId, user.name ?? user.email);
        this.knownUsers.add(user.userId);
      }
      return user;
    } catch (err) {
      if (err instanceof InvalidToken) throw new HttpError(401, err.message);
      throw err;
    }
  }

  guestId(req: FastifyRequest): string | null {
    const id = req.headers['x-guest-id'];
    return typeof id === 'string' && UUID.test(id) ? id.toLowerCase() : null;
  }

  async player(req: FastifyRequest): Promise<Player> {
    const user = await this.user(req);
    if (user) return { kind: 'user', userId: user.userId };
    const guestId = this.guestId(req);
    if (guestId) return { kind: 'guest', guestId };
    throw new HttpError(401, 'Missing player identity (sign in, or send X-Guest-Id).');
  }
}
