import type { ActionLogEntry, DecisionFeedback, DecisionStar, HandConfig, HandResult, Position, SessionCoachReview, SessionStats } from '@gtotutor/shared-types';

/** A coach review that came back clean, so it can be kept and shown again without asking the coach. */
export type SavedCoachReview = Extract<SessionCoachReview, { status: 'ok' }>;

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
  /** Whether a saved decision is starred, and its note. */
  star(decisionId: string): Promise<DecisionStar>;
  /** Stars or unstars a saved decision. Unstarring clears the note. */
  setStar(decisionId: string, star: DecisionStar): Promise<void>;
  /** The coach review saved for a session at this many decisions, if any. */
  sessionReview(sessionId: string, decisionsCount: number): Promise<SavedCoachReview | null>;
  /** Keeps a session review; one already saved for the same count stays as it is. */
  saveSessionReview(sessionId: string, decisionsCount: number, stats: SessionStats, coach: SavedCoachReview): Promise<void>;
  /** An account's most recent decisions (at most `limit`) grouped by hand, and how many it has in all. */
  playerDecisions(userId: string, limit: number): Promise<PlayerDecisions>;
  /** An account's starred decisions, newest star first, starred before `before` if given. */
  starredDecisions(userId: string, before: Date | null, limit: number): Promise<StarredRow[]>;
  starredCount(userId: string): Promise<number>;
  /** The saved all-time coach review for an account, and the decision count it was written at. */
  profileReview(userId: string): Promise<{ decisionsCount: number; coach: SavedCoachReview } | null>;
  /** Replaces the account's saved all-time review. */
  saveProfileReview(userId: string, decisionsCount: number, stats: SessionStats, coach: SavedCoachReview): Promise<void>;
}

/**
 * An account's most recent decisions, grouped by hand (newest hand first), and how many decisions it
 * has in all. The oldest hand can be partial when the limit cuts through it.
 */
export interface PlayerDecisions {
  hands: { handId: string; decisions: DecisionFeedback[] }[];
  total: number;
}

/** Groups decisions (newest first) into hands, keeping that order. */
export function groupByHand(rows: { handId: string; decision: DecisionFeedback }[]): PlayerDecisions['hands'] {
  const byHand = new Map<string, DecisionFeedback[]>();
  for (const r of rows) byHand.set(r.handId, [...(byHand.get(r.handId) ?? []), r.decision]);
  return [...byHand].map(([handId, decisions]) => ({ handId, decisions }));
}

export interface StarredRow {
  handId: string;
  decision: DecisionFeedback;
  note: string | null;
  starredAt: Date;
}

/** In-memory Repo with the same semantics, for tests and running without a database. */
export class MemoryRepo implements Repo {
  private readonly sessions = new Map<string, { owner: Player; lastActive: Date }>();
  private readonly hands = new Map<string, HandRecord>();
  readonly profiles = new Map<string, string | null>();
  private readonly coach: { decisionId: string; owner: Player; message: CoachMessage }[] = [];
  private readonly stars = new Map<string, { note: string | null; at: Date }>(); // starred decision id
  private readonly reviews = new Map<string, { sessionId: string; coach: SavedCoachReview }>(); // `${sessionId}|${count}`
  private readonly profileReviews = new Map<string, { decisionsCount: number; coach: SavedCoachReview }>();
  private lastStarAt = 0;

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

  async star(decisionId: string): Promise<DecisionStar> {
    const s = this.stars.get(decisionId);
    return s ? { starred: true, note: s.note } : { starred: false, note: null };
  }

  async setStar(decisionId: string, star: DecisionStar): Promise<void> {
    if (!star.starred) {
      this.stars.delete(decisionId);
      return;
    }
    // Editing the note keeps the original star time; distinct times keep "newest first" stable.
    this.lastStarAt = Math.max(Date.now(), this.lastStarAt + 1);
    const at = this.stars.get(decisionId)?.at ?? new Date(this.lastStarAt);
    this.stars.set(decisionId, { note: star.note, at });
  }

  async playerDecisions(userId: string, limit: number): Promise<PlayerDecisions> {
    const all = this.userHands(userId).flatMap((h) => h.decisions.map((decision) => ({ handId: h.id, decision })));
    return { hands: groupByHand(structuredClone(all.reverse().slice(0, limit))), total: all.length };
  }

  async starredDecisions(userId: string, before: Date | null, limit: number): Promise<StarredRow[]> {
    const rows: StarredRow[] = [];
    for (const h of this.userHands(userId)) {
      for (const d of h.decisions) {
        const s = this.stars.get(d.id);
        if (s && (!before || s.at < before)) rows.push({ handId: h.id, decision: structuredClone(d), note: s.note, starredAt: s.at });
      }
    }
    return rows.sort((a, b) => b.starredAt.getTime() - a.starredAt.getTime()).slice(0, limit);
  }

  async starredCount(userId: string): Promise<number> {
    return (await this.starredDecisions(userId, null, Number.MAX_SAFE_INTEGER)).length;
  }

  async profileReview(userId: string): Promise<{ decisionsCount: number; coach: SavedCoachReview } | null> {
    const r = this.profileReviews.get(userId);
    return r ? structuredClone(r) : null;
  }

  async saveProfileReview(userId: string, decisionsCount: number, _stats: SessionStats, coach: SavedCoachReview): Promise<void> {
    this.profileReviews.set(userId, { decisionsCount, coach: structuredClone(coach) });
  }

  private userHands(userId: string): HandRecord[] {
    return [...this.hands.values()].filter((h) => h.owner.kind === 'user' && h.owner.userId === userId);
  }

  async sessionReview(sessionId: string, decisionsCount: number): Promise<SavedCoachReview | null> {
    const saved = this.reviews.get(`${sessionId}|${decisionsCount}`);
    return saved ? structuredClone(saved.coach) : null;
  }

  async saveSessionReview(sessionId: string, decisionsCount: number, _stats: SessionStats, coach: SavedCoachReview): Promise<void> {
    const key = `${sessionId}|${decisionsCount}`;
    if (!this.reviews.has(key)) this.reviews.set(key, { sessionId, coach: structuredClone(coach) });
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
    // Coach messages, stars and reviews go with their decisions and sessions, like the database's cascades.
    for (let i = this.coach.length - 1; i >= 0; i--) if (doomedDecisions.has(this.coach[i].decisionId)) this.coach.splice(i, 1);
    for (const id of doomedDecisions) this.stars.delete(id);
    for (const [key, r] of this.reviews) if (doomed.includes(r.sessionId)) this.reviews.delete(key);
    return doomed.length;
  }
}
