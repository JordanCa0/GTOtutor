import type { DecisionFeedback, DecisionStar, SessionStats } from '@gtotutor/shared-types';
import { and, asc, desc, eq, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { spotTypeOf } from '../teacher/sessionStats.js';
import type { CoachMessage, HandRecord, HandReplay, Player, Repo, SavedCoachReview, StarredRow } from './repo.js';
import * as schema from './schema.js';
import { coachMessages, decisions, hands, practiceSessions, profileReviews, profiles, sessionReviews } from './schema.js';

const ownerCols = (p: Player) => (p.kind === 'user' ? { userId: p.userId, guestId: null } : { userId: null, guestId: p.guestId });
const rowOwner = (r: { userId: string | null; guestId: string | null }): Player =>
  r.userId ? { kind: 'user', userId: r.userId } : { kind: 'guest', guestId: r.guestId! };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Db = ReturnType<typeof createDb>;

/** Connects to Supabase Postgres (pooler URLs don't support prepared statements). */
export function createDb(url: string) {
  return drizzle(postgres(url, { max: 5, prepare: false }), { schema });
}

export class PgRepo implements Repo {
  constructor(private readonly db: Db) {}

  async ensureSession(sessionId: string, player: Player): Promise<Player> {
    await this.db.insert(practiceSessions).values({ id: sessionId, ...ownerCols(player) }).onConflictDoNothing();
    const [row] = await this.db.select().from(practiceSessions).where(eq(practiceSessions.id, sessionId));
    return rowOwner(row);
  }

  async saveHand(hand: HandRecord): Promise<void> {
    const owner = ownerCols(hand.owner);
    const complete = hand.status === 'complete';
    const row = {
      id: hand.id,
      sessionId: hand.sessionId,
      ...owner,
      status: hand.status,
      heroPosition: hand.heroPosition,
      config: hand.config,
      flopPractice: hand.flopPractice,
      state: hand.state,
      result: hand.replay,
      netBb: hand.netBb,
      updatedAt: new Date(),
      completedAt: complete ? new Date() : null,
    };
    await this.db.transaction(async (tx) => {
      await tx
        .insert(hands)
        .values(row)
        .onConflictDoUpdate({
          target: hands.id,
          set: { status: row.status, state: row.state, result: row.result, netBb: row.netBb, updatedAt: row.updatedAt, completedAt: row.completedAt },
        });
      if (hand.decisions.length) {
        // Decisions never change once made; stars, notes and tags are edited separately.
        await tx
          .insert(decisions)
          .values(hand.decisions.map((d, i) => decisionRow(hand, d, i + 1)))
          .onConflictDoNothing();
      }
      await tx.update(practiceSessions).set({ lastActiveAt: new Date() }).where(eq(practiceSessions.id, hand.sessionId));
    });
  }

  async getHand(id: string): Promise<HandRecord | null> {
    // Hand ids are uuids; anything else can't exist (and would be a type error in Postgres).
    if (!UUID.test(id)) return null;
    const [row] = await this.db.select().from(hands).where(eq(hands.id, id));
    if (!row) return null;
    const ds = await this.db.select({ feedback: decisions.feedback }).from(decisions).where(eq(decisions.handId, id)).orderBy(asc(decisions.idx));
    return toRecord(row, ds.map((d) => d.feedback as DecisionFeedback));
  }

  async sessionOwner(sessionId: string): Promise<Player | null> {
    const [row] = await this.db.select().from(practiceSessions).where(eq(practiceSessions.id, sessionId));
    return row ? rowOwner(row) : null;
  }

  async sessionHands(sessionId: string): Promise<HandRecord[]> {
    const rows = await this.db.select().from(hands).where(eq(hands.sessionId, sessionId)).orderBy(asc(hands.createdAt));
    if (!rows.length) return [];
    const ds = await this.db
      .select({ handId: decisions.handId, feedback: decisions.feedback })
      .from(decisions)
      .where(inArray(decisions.handId, rows.map((r) => r.id)))
      .orderBy(asc(decisions.idx));
    return rows.map((r) => toRecord(r, ds.filter((d) => d.handId === r.id).map((d) => d.feedback as DecisionFeedback)));
  }

  async deleteGuestSessions(guestId: string, keepSessionId?: string): Promise<number> {
    const where = keepSessionId
      ? and(eq(practiceSessions.guestId, guestId), ne(practiceSessions.id, keepSessionId))
      : eq(practiceSessions.guestId, guestId);
    const deleted = await this.db.delete(practiceSessions).where(where).returning({ id: practiceSessions.id });
    return deleted.length;
  }

  async purgeIdleGuestSessions(before: Date): Promise<number> {
    const deleted = await this.db
      .delete(practiceSessions)
      .where(and(isNotNull(practiceSessions.guestId), lt(practiceSessions.lastActiveAt, before)))
      .returning({ id: practiceSessions.id });
    return deleted.length;
  }

  async claimGuest(guestId: string, userId: string): Promise<void> {
    const move = { userId, guestId: null };
    await this.db.transaction(async (tx) => {
      await tx.update(practiceSessions).set(move).where(eq(practiceSessions.guestId, guestId));
      await tx.update(hands).set(move).where(eq(hands.guestId, guestId));
      await tx.update(decisions).set(move).where(eq(decisions.guestId, guestId));
      await tx.update(coachMessages).set(move).where(eq(coachMessages.guestId, guestId));
    });
  }

  async ensureProfile(userId: string, displayName: string | null): Promise<void> {
    await this.db.insert(profiles).values({ userId, displayName }).onConflictDoNothing();
  }

  async coachMessages(decisionId: string): Promise<CoachMessage[]> {
    const rows = await this.db.select().from(coachMessages).where(eq(coachMessages.decisionId, decisionId)).orderBy(asc(coachMessages.createdAt));
    return rows.map((r) => ({
      kind: r.kind as CoachMessage['kind'],
      role: r.role as CoachMessage['role'],
      tldr: r.tldr,
      content: r.content,
      points: r.points as string[] | null,
      ungrounded: r.ungrounded as string[] | null,
    }));
  }

  async addCoachMessages(decisionId: string, owner: Player, messages: CoachMessage[]): Promise<void> {
    if (!messages.length) return;
    // A question and its answer are written together; space their timestamps so they stay in order.
    const now = Date.now();
    await this.db.insert(coachMessages).values(messages.map((m, i) => ({ decisionId, ...ownerCols(owner), ...m, createdAt: new Date(now + i) })));
  }

  async star(decisionId: string): Promise<DecisionStar> {
    const [row] = await this.db.select({ starredAt: decisions.starredAt, note: decisions.note }).from(decisions).where(eq(decisions.id, decisionId));
    return row?.starredAt ? { starred: true, note: row.note } : { starred: false, note: null };
  }

  async setStar(decisionId: string, star: DecisionStar): Promise<void> {
    await this.db
      .update(decisions)
      .set(star.starred ? { starredAt: sql`coalesce(${decisions.starredAt}, now())`, note: star.note } : { starredAt: null, note: null })
      .where(eq(decisions.id, decisionId));
  }

  async sessionReview(sessionId: string, decisionsCount: number): Promise<SavedCoachReview | null> {
    const [row] = await this.db
      .select({ coach: sessionReviews.coach })
      .from(sessionReviews)
      .where(and(eq(sessionReviews.sessionId, sessionId), eq(sessionReviews.decisionsCount, decisionsCount)));
    return row ? (row.coach as SavedCoachReview) : null;
  }

  async saveSessionReview(sessionId: string, decisionsCount: number, stats: SessionStats, coach: SavedCoachReview): Promise<void> {
    await this.db.insert(sessionReviews).values({ sessionId, decisionsCount, stats, coach }).onConflictDoNothing();
  }

  async playerDecisions(userId: string, limit: number): Promise<{ decisions: DecisionFeedback[]; total: number }> {
    const rows = await this.db
      .select({ feedback: decisions.feedback })
      .from(decisions)
      .where(eq(decisions.userId, userId))
      .orderBy(desc(decisions.createdAt), desc(decisions.idx))
      .limit(limit);
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(decisions).where(eq(decisions.userId, userId));
    return { decisions: rows.map((r) => r.feedback as DecisionFeedback), total: n };
  }

  async starredDecisions(userId: string, before: Date | null, limit: number): Promise<StarredRow[]> {
    const rows = await this.db
      .select({ handId: decisions.handId, feedback: decisions.feedback, note: decisions.note, starredAt: decisions.starredAt })
      .from(decisions)
      .where(and(eq(decisions.userId, userId), isNotNull(decisions.starredAt), before ? lt(decisions.starredAt, before) : undefined))
      .orderBy(desc(decisions.starredAt))
      .limit(limit);
    return rows.map((r) => ({ handId: r.handId, decision: r.feedback as DecisionFeedback, note: r.note, starredAt: r.starredAt! }));
  }

  async starredCount(userId: string): Promise<number> {
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(decisions)
      .where(and(eq(decisions.userId, userId), isNotNull(decisions.starredAt)));
    return n;
  }

  async profileReview(userId: string): Promise<{ decisionsCount: number; coach: SavedCoachReview } | null> {
    const [row] = await this.db.select().from(profileReviews).where(eq(profileReviews.userId, userId));
    return row ? { decisionsCount: row.decisionsCount, coach: row.coach as SavedCoachReview } : null;
  }

  async saveProfileReview(userId: string, decisionsCount: number, stats: SessionStats, coach: SavedCoachReview): Promise<void> {
    const values = { userId, decisionsCount, stats, coach, createdAt: new Date() };
    await this.db.insert(profileReviews).values(values).onConflictDoUpdate({ target: profileReviews.userId, set: { decisionsCount, stats, coach, createdAt: values.createdAt } });
  }

  /** For checks and scripts: row counts per table. */
  async counts(): Promise<Record<string, number>> {
    const rows = await this.db.execute<{ t: string; n: number }>(sql`
      select 'hands' as t, count(*)::int as n from hands union all
      select 'decisions', count(*)::int from decisions union all
      select 'practice_sessions', count(*)::int from practice_sessions`);
    return Object.fromEntries([...rows].map((r) => [r.t, r.n]));
  }
}

function decisionRow(hand: HandRecord, d: DecisionFeedback, idx: number) {
  return {
    id: d.id,
    handId: hand.id,
    ...ownerCols(hand.owner),
    idx,
    street: d.street,
    nodeKey: d.nodeKey,
    spotType: spotTypeOf(d.nodeKey),
    handClass: d.handClass,
    heroCards: d.heroCards,
    board: d.board,
    chosenAction: d.chosenAction,
    bestAction: d.bestAction,
    grade: d.grade,
    chosenFrequency: d.chosenFrequency,
    feedback: d,
    approxFlop: d.approxFlop,
    hintUsed: d.hintUsed,
  };
}

function toRecord(row: typeof hands.$inferSelect, ds: DecisionFeedback[]): HandRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    owner: rowOwner(row),
    status: row.status as HandRecord['status'],
    heroPosition: row.heroPosition as HandRecord['heroPosition'],
    config: row.config as HandRecord['config'],
    flopPractice: row.flopPractice,
    state: row.state,
    replay: row.result as HandReplay | null,
    netBb: row.netBb,
    decisions: ds,
  };
}
