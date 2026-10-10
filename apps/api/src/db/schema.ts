/**
 * Database schema (Supabase Postgres). Only the API reads or writes these tables: Row Level
 * Security is enabled on all of them with no policies (see the migrations), so the public
 * Supabase key can't touch them. See docs/accounts-and-data.md.
 *
 * Player-owned rows have exactly one owner: `user_id` (a Supabase auth user; the foreign key to
 * auth.users is added in SQL because that schema isn't managed here) or `guest_id` (a random id
 * the browser keeps until the guest signs up). Guest data is temporary: a guest session and its
 * rows are deleted when the guest starts a new session or after 24 hours idle, unless they sign up.
 */
import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const owner = {
  userId: uuid('user_id'),
  guestId: uuid('guest_id'),
};
const oneOwner = (name: string) => (t: { userId: unknown; guestId: unknown }) =>
  check(`${name}_one_owner`, sql`(${t.userId} is null) <> (${t.guestId} is null)`);
const createdAt = timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  displayName: text('display_name'),
  settings: jsonb('settings').notNull().default({}),
  createdAt,
});

export const practiceSessions = pgTable(
  'practice_sessions',
  {
    id: text('id').primaryKey(),
    ...owner,
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    /** Last hand dealt; guest sessions idle for 24 hours are deleted. */
    lastActiveAt: timestamp('last_active_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [oneOwner('practice_sessions')(t), index('practice_sessions_user_idx').on(t.userId, t.startedAt), index('practice_sessions_guest_idx').on(t.guestId)],
);

export const hands = pgTable(
  'hands',
  {
    id: uuid('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => practiceSessions.id, { onDelete: 'cascade' }),
    ...owner,
    status: text('status').notNull(), // 'awaiting_hero' | 'complete'
    heroPosition: text('hero_position').notNull(),
    config: jsonb('config').notNull(),
    flopPractice: boolean('flop_practice').notNull().default(false),
    /** The engine's full state while the hand is played (survives restarts); cleared once it completes. */
    state: jsonb('state'),
    result: jsonb('result'),
    netBb: real('net_bb'),
    createdAt,
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [oneOwner('hands')(t), index('hands_user_idx').on(t.userId, t.createdAt), index('hands_guest_idx').on(t.guestId), index('hands_session_idx').on(t.sessionId)],
);

export const decisions = pgTable(
  'decisions',
  {
    id: text('id').primaryKey(), // "<hand id>-d<n>", as DecisionFeedback.id
    handId: uuid('hand_id')
      .notNull()
      .references(() => hands.id, { onDelete: 'cascade' }),
    ...owner,
    idx: integer('idx').notNull(),
    street: text('street').notNull(),
    nodeKey: text('node_key').notNull(),
    spotType: text('spot_type').notNull(),
    handClass: text('hand_class').notNull(),
    heroCards: text('hero_cards').array().notNull(),
    board: text('board').array().notNull(),
    chosenAction: text('chosen_action').notNull(),
    bestAction: text('best_action').notNull(),
    grade: text('grade').notNull(),
    chosenFrequency: real('chosen_frequency').notNull(),
    /** The full DecisionFeedback, for replaying the verdict exactly. */
    feedback: jsonb('feedback').notNull(),
    approxFlop: text('approx_flop'),
    hintUsed: boolean('hint_used').notNull().default(false),
    starredAt: timestamp('starred_at', { withTimezone: true }),
    note: text('note'),
    /** Player's own labels for filtering (e.g. sizing, bluff-catch). */
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    createdAt,
  },
  (t) => [
    oneOwner('decisions')(t),
    index('decisions_user_idx').on(t.userId, t.createdAt),
    index('decisions_user_spot_idx').on(t.userId, t.spotType),
    index('decisions_user_star_idx').on(t.userId, t.starredAt),
    index('decisions_tags_idx').using('gin', t.tags),
    index('decisions_guest_idx').on(t.guestId),
    index('decisions_hand_idx').on(t.handId),
  ],
);

export const coachMessages = pgTable(
  'coach_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    decisionId: text('decision_id')
      .notNull()
      .references(() => decisions.id, { onDelete: 'cascade' }),
    ...owner,
    kind: text('kind').notNull(), // 'explanation' | 'chat'
    role: text('role').notNull(), // 'user' | 'assistant'
    tldr: text('tldr'),
    content: text('content').notNull(),
    points: jsonb('points'),
    ungrounded: jsonb('ungrounded'),
    createdAt,
  },
  (t) => [oneOwner('coach_messages')(t), index('coach_messages_decision_idx').on(t.decisionId, t.createdAt), index('coach_messages_guest_idx').on(t.guestId)],
);

export const sessionReviews = pgTable(
  'session_reviews',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => practiceSessions.id, { onDelete: 'cascade' }),
    decisionsCount: integer('decisions_count').notNull(),
    stats: jsonb('stats').notNull(),
    coach: jsonb('coach').notNull(),
    createdAt,
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.decisionsCount] })],
);

/** The coach's all-time review on the profile page: one per account, refreshed every so many decisions. */
export const profileReviews = pgTable('profile_reviews', {
  userId: uuid('user_id').primaryKey(), // → auth.users, on delete cascade (added in the migration)
  decisionsCount: integer('decisions_count').notNull(),
  stats: jsonb('stats').notNull(),
  coach: jsonb('coach').notNull(),
  createdAt,
});

export const solverSpots = pgTable('solver_spots', {
  name: text('name').primaryKey(),
  chartVersion: text('chart_version'),
  spot: jsonb('spot').notNull(), // the solver/spots/<name>.json definition (ranges, pot, tree)
  createdAt,
});

export const solvedFlops = pgTable(
  'solved_flops',
  {
    spot: text('spot')
      .notNull()
      .references(() => solverSpots.name, { onDelete: 'cascade' }),
    flop: text('flop').notNull(),
    weight: integer('weight').notNull(),
    exploitabilityPctPot: real('exploitability_pct_pot').notNull(),
    tree: jsonb('tree'),
    hasEv: boolean('has_ev').notNull(),
    storagePath: text('storage_path').notNull(),
    bytes: integer('bytes').notNull(),
    sha256: text('sha256').notNull(),
    solvedAt: timestamp('solved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.spot, t.flop] })],
);
