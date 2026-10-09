import type { ActionLogEntry, DecisionFeedback, HandConfig, HandResult, Position } from '@gtotutor/shared-types';

/** Who is playing: a signed-in account or a browser guest. */
export type Player = { kind: 'user'; userId: string } | { kind: 'guest'; guestId: string };

export const playerKey = (p: Player) => (p.kind === 'user' ? `u:${p.userId}` : `g:${p.guestId}`);
export const samePlayer = (a: Player, b: Player) => playerKey(a) === playerKey(b);

/** What a finished hand keeps once the engine state is cleared: enough to replay and coach it. */
export interface HandReplay {
  actionLog: ActionLogEntry[];
  result: HandResult;
}

/** A hand as stored. `state` is the engine's state while in progress and null once complete. */
export interface HandRecord {
  id: string;
  sessionId: string;
  owner: Player;
  status: 'awaiting_hero' | 'complete';
  heroPosition: Position;
  config: HandConfig & { easyFoldsSkipped: boolean };
  flopPractice: boolean;
  state: unknown | null;
  replay: HandReplay | null;
  netBb: number | null;
  decisions: DecisionFeedback[];
}

/** One saved coach message: an explanation (the Analyze button) or a chat turn. */
export interface CoachMessage {
  kind: 'explanation' | 'chat';
  role: 'user' | 'assistant';
  tldr: string | null;
  content: string;
  points: string[] | null;
  ungrounded: string[] | null;
}

/**
 * Persistence for player data. `PgRepo` (Supabase Postgres) in the app, `MemoryRepo` in tests.
 * Ownership is checked by callers (HandService); the repo stores what it's given.
 */
export interface Repo {
  /** Creates the session if new. Returns its owner (which may differ from `player` if the id is taken). */
  ensureSession(sessionId: string, player: Player): Promise<Player>;
  /** Inserts or updates a hand and its decisions, and marks the session active. */
  saveHand(hand: HandRecord): Promise<void>;
  getHand(id: string): Promise<HandRecord | null>;
  sessionOwner(sessionId: string): Promise<Player | null>;
  sessionHands(sessionId: string): Promise<HandRecord[]>;
  /** Deletes a guest's sessions (and everything in them) except `keepSessionId`. */
  deleteGuestSessions(guestId: string, keepSessionId?: string): Promise<number>;
  /** Deletes guest sessions with no new hand since `before`. */
  purgeIdleGuestSessions(before: Date): Promise<number>;
  /** Moves every row a guest owns to a user account. */
  claimGuest(guestId: string, userId: string): Promise<void>;
  ensureProfile(userId: string, displayName: string | null): Promise<void>;
  /** A decision's coach messages, oldest first. */
  coachMessages(decisionId: string): Promise<CoachMessage[]>;
  /** Appends messages to a decision's coach thread, in the order given. */
  addCoachMessages(decisionId: string, owner: Player, messages: CoachMessage[]): Promise<void>;
}

/** In-memory Repo with the same semantics, for tests and running without a database. */
export class MemoryRepo implements Repo {
  private readonly sessions = new Map<string, { owner: Player; lastActive: Date }>();
  private readonly hands = new Map<string, HandRecord>();
  readonly profiles = new Map<string, string | null>();
  private readonly coach: { decisionId: string; owner: Player; message: CoachMessage }[] = [];

  async ensureSession(sessionId: string, player: Player): Promise<Player> {
    const s = this.sessions.get(sessionId);
    if (s) return s.owner;
    this.sessions.set(sessionId, { owner: player, lastActive: new Date() });
    return player;
  }

  async saveHand(hand: HandRecord): Promise<void> {
    this.hands.set(hand.id, structuredClone(hand));
    const s = this.sessions.get(hand.sessionId);
    if (s) s.lastActive = new Date();
  }

  async getHand(id: string): Promise<HandRecord | null> {
    const h = this.hands.get(id);
    return h ? structuredClone(h) : null;
  }

  async sessionOwner(sessionId: string): Promise<Player | null> {
    return this.sessions.get(sessionId)?.owner ?? null;
  }

  async sessionHands(sessionId: string): Promise<HandRecord[]> {
    return [...this.hands.values()].filter((h) => h.sessionId === sessionId).map((h) => structuredClone(h));
  }

  async deleteGuestSessions(guestId: string, keepSessionId?: string): Promise<number> {
    return this.deleteSessions(([id, s]) => s.owner.kind === 'guest' && s.owner.guestId === guestId && id !== keepSessionId);
  }

  async purgeIdleGuestSessions(before: Date): Promise<number> {
    return this.deleteSessions(([, s]) => s.owner.kind === 'guest' && s.lastActive < before);
  }

  /** Test helper: pretend a session was last active at `when`. */
  setLastActive(sessionId: string, when: Date): void {
    const s = this.sessions.get(sessionId);
    if (s) s.lastActive = when;
  }

  async claimGuest(guestId: string, userId: string): Promise<void> {
    const user: Player = { kind: 'user', userId };
    const isGuest = (p: Player) => p.kind === 'guest' && p.guestId === guestId;
    for (const s of this.sessions.values()) if (isGuest(s.owner)) s.owner = user;
    for (const h of this.hands.values()) if (isGuest(h.owner)) h.owner = user;
    for (const c of this.coach) if (isGuest(c.owner)) c.owner = user;
  }

  async ensureProfile(userId: string, displayName: string | null): Promise<void> {
    if (!this.profiles.has(userId)) this.profiles.set(userId, displayName);
  }

  async coachMessages(decisionId: string): Promise<CoachMessage[]> {
    return this.coach.filter((c) => c.decisionId === decisionId).map((c) => structuredClone(c.message));
  }

  async addCoachMessages(decisionId: string, owner: Player, messages: CoachMessage[]): Promise<void> {
    for (const message of messages) this.coach.push({ decisionId, owner, message: structuredClone(message) });
  }

  private deleteSessions(match: (entry: [string, { owner: Player; lastActive: Date }]) => boolean): number {
    const doomed = [...this.sessions.entries()].filter(match).map(([id]) => id);
    const doomedDecisions = new Set<string>();
    for (const id of doomed) {
      this.sessions.delete(id);
      for (const [hid, h] of this.hands) {
        if (h.sessionId !== id) continue;
        for (const d of h.decisions) doomedDecisions.add(d.id);
        this.hands.delete(hid);
      }
    }
    // Coach messages go with their decisions, like the database's cascade.
    for (let i = this.coach.length - 1; i >= 0; i--) if (doomedDecisions.has(this.coach[i].decisionId)) this.coach.splice(i, 1);
    return doomed.length;
  }
}
