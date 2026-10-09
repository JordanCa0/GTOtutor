import {
  CHAT_LIMITS,
  MIN_DECISIONS_FOR_REVIEW,
  STAR_NOTE_MAX_CHARS,
  type ChartNodeView,
  type ChatRequest,
  type ChatResponse,
  type CoachThreadResponse,
  type DecisionStar,
  type ExplanationResponse,
  type HandView,
  type HintResponse,
  type MeResponse,
  type ProfileResponse,
  type ProfileReviewResponse,
  type SessionReviewResponse,
  type StarredResponse,
  type StarRequest,
  type StartHandRequest,
  type SubmitDecisionRequest,
  type SubmitDecisionResponse,
} from '@gtotutor/shared-types';
import Fastify, { type FastifyInstance } from 'fastify';
import type { AccountAdmin } from './auth/accounts.js';
import type { PlayerResolver } from './auth/player.js';
import type { ChartService } from './charts/chartService.js';
import { playerKey, type CoachMessage } from './db/repo.js';
import { HttpError, isFlopNodeKey, type HandEngine } from './engine/handEngine.js';
import type { HandContext, HandService } from './engine/handService.js';
import type { ExplainInput, LlmTeacher, SpotContext } from './teacher/llmTeacher.js';
import { gtoSummaryOf, styleOf } from './teacher/playerStyle.js';
import { computeSessionStats } from './teacher/sessionStats.js';

/** The profile looks at an account's most recent decisions, up to this many. */
export const PROFILE_DECISIONS = 5000;
/** The all-time coach review is written again once this many new decisions have been played. */
export const PROFILE_REVIEW_EVERY = 25;

export interface AppDeps {
  charts: ChartService;
  engine: HandEngine;
  hands: HandService;
  players: PlayerResolver;
  teacher: LlmTeacher;
  /** Deletes Supabase accounts; without it, DELETE /api/me answers 501. */
  accounts?: AccountAdmin;
}

const sessionIdSchema = { type: 'string', pattern: '^[A-Za-z0-9-]{8,64}$' } as const;

const startHandSchema = {
  type: 'object',
  required: ['tableSize', 'stackDepthBb', 'heroPosition', 'sessionId'],
  additionalProperties: false,
  properties: {
    tableSize: { enum: ['HU', 'SIX_MAX', 'NINE_MAX'] },
    stackDepthBb: { enum: [20, 40, 60, 100, 150] },
    heroPosition: { enum: ['random', 'UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] },
    sessionId: sessionIdSchema,
    skipEasyFolds: { type: 'boolean' },
    flopPractice: { type: 'boolean' },
  },
} as const;

const decisionSchema = {
  type: 'object',
  required: ['action'],
  additionalProperties: false,
  properties: { action: { enum: ['fold', 'check', 'call', 'bet', 'raise', 'allin'] } },
} as const;

const chatSchema = {
  type: 'object',
  required: ['messages'],
  additionalProperties: false,
  properties: {
    messages: {
      type: 'array',
      minItems: 1,
      maxItems: CHAT_LIMITS.maxUserTurns * 2 - 1,
      items: {
        type: 'object',
        required: ['role', 'content'],
        additionalProperties: false,
        properties: { role: { enum: ['user', 'assistant'] }, content: { type: 'string', minLength: 1, maxLength: 4000 }, tldr: { type: 'string', maxLength: 500 } },
      },
    },
  },
} as const;

const starSchema = {
  type: 'object',
  required: ['starred'],
  additionalProperties: false,
  properties: { starred: { type: 'boolean' }, note: { type: ['string', 'null'], maxLength: STAR_NOTE_MAX_CHARS } },
} as const;

/** The saved explanation in a coach thread, shaped like a fresh one. */
function savedExplanation(thread: CoachMessage[]): Extract<ExplanationResponse, { status: 'ok' }> | null {
  const m = thread.find((x) => x.kind === 'explanation');
  return m ? { status: 'ok', tldr: m.tldr ?? '', points: m.points ?? [], cached: true, ungroundedNumbers: m.ungrounded ?? [] } : null;
}

export function buildApp({ charts, engine, hands, players, teacher, accounts }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    const e = err as { validation?: unknown; message?: string };
    if (e.validation) return reply.status(400).send({ error: e.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  });

  const baseSpot = (ctx: Pick<HandContext, 'heroPosition' | 'stackDepthBb'>, spot: { nodeKey: string; nodeLabel: string; board: string[]; approxFlop: string | null }) => ({
    nodeKey: spot.nodeKey,
    nodeLabel: spot.nodeLabel,
    heroPosition: ctx.heroPosition,
    stackDepthBb: ctx.stackDepthBb,
    rangeSummary: engine.rangeSummary(spot.nodeKey),
    board: spot.board,
    approxFlop: spot.approxFlop,
    dataSource: charts.dataSource,
  });

  const decisionInput = (ctx: HandContext, decisionId: string): ExplainInput => {
    const k = ctx.decisions.findIndex((d) => d.id === decisionId);
    if (k < 0) throw new HttpError(404, 'Decision not found.');
    const decision = ctx.decisions[k];
    // The k-th hero entry in the log is this decision; everything before it is the context.
    let heroSeen = 0;
    const cut = ctx.actionLog.findIndex((a) => a.isHero && heroSeen++ === k);
    return {
      ...baseSpot(ctx, decision),
      decision,
      heroCards: decision.heroCards,
      handClass: decision.handClass,
      options: decision.options,
      actionsBefore: ctx.actionLog.slice(0, cut),
      priorDecisions: ctx.decisions.slice(0, k),
    };
  };

  app.get('/api/health', async () => ({ ok: true }));

  app.post<{ Body: StartHandRequest }>('/api/hands', { schema: { body: startHandSchema } }, async (req): Promise<HandView> => {
    const state = await hands.start(await players.player(req), req.body);
    return engine.view(state);
  });

  app.get<{ Params: { id: string } }>('/api/hands/:id', async (req): Promise<HandView> => engine.view(await hands.get(await players.player(req), req.params.id)));

  app.post<{ Params: { id: string }; Body: SubmitDecisionRequest }>(
    '/api/hands/:id/decisions',
    { schema: { body: decisionSchema } },
    async (req): Promise<SubmitDecisionResponse> => {
      const { state, feedback } = await hands.decide(await players.player(req), req.params.id, req.body.action);
      return { feedback, hand: engine.view(state) };
    },
  );

  app.get<{ Params: { id: string } }>('/api/hands/:id/hint', async (req): Promise<HintResponse> => {
    const player = await players.player(req);
    const state = await hands.get(player, req.params.id);
    const pending = engine.pendingDecision(state);
    if (!pending) throw new HttpError(409, 'There is no pending decision to hint at.');
    const spot: SpotContext = {
      ...baseSpot({ heroPosition: state.heroPosition, stackDepthBb: state.config.stackDepthBb }, { ...pending, board: state.board }),
      heroCards: pending.heroCards,
      handClass: pending.handClass,
      options: pending.options,
      actionsBefore: state.actionLog,
      priorDecisions: state.decisions,
    };
    const res = await teacher.hint(spot, playerKey(player));
    if (res.status === 'ok') await hands.markHintUsed(player, req.params.id);
    return res;
  });

  app.get<{ Params: { id: string; decisionId: string } }>(
    '/api/hands/:id/decisions/:decisionId/explanation',
    async (req): Promise<ExplanationResponse> => {
      const player = await players.player(req);
      const ctx = await hands.context(player, req.params.id);
      const input = decisionInput(ctx, req.params.decisionId);
      // A decision's explanation is paid for once; after that it comes from the database.
      const saved = savedExplanation(await hands.coachMessages(ctx, req.params.decisionId));
      if (saved) return saved;
      const res = await teacher.explain(input, playerKey(player));
      // Explanations with invented numbers aren't kept, so Retry can replace them.
      if (res.status === 'ok' && res.ungroundedNumbers.length === 0) {
        await hands.addCoachMessages(ctx, req.params.decisionId, [
          { kind: 'explanation', role: 'assistant', tldr: res.tldr, content: res.points.join('\n'), points: res.points, ungrounded: null },
        ]);
      }
      return res;
    },
  );

  app.get<{ Params: { id: string; decisionId: string } }>(
    '/api/hands/:id/decisions/:decisionId/coach',
    async (req): Promise<CoachThreadResponse> => {
      const ctx = await hands.context(await players.player(req), req.params.id);
      const saved = await hands.coachMessages(ctx, req.params.decisionId);
      return {
        explanation: savedExplanation(saved),
        messages: saved
          .filter((m) => m.kind === 'chat')
          .map(({ role, content, tldr }) => ({ role, content, ...(tldr ? { tldr } : {}) })),
      };
    },
  );

  app.post<{ Params: { id: string; decisionId: string }; Body: ChatRequest }>(
    '/api/hands/:id/decisions/:decisionId/chat',
    { schema: { body: chatSchema } },
    async (req): Promise<ChatResponse> => {
      const { messages } = req.body;
      if (messages.at(-1)!.role !== 'user') throw new HttpError(400, 'The last message must be from the user.');
      if (messages.some((m) => m.role === 'user' && m.content.length > CHAT_LIMITS.maxUserChars)) {
        throw new HttpError(400, `Questions are limited to ${CHAT_LIMITS.maxUserChars} characters.`);
      }
      const player = await players.player(req);
      const ctx = await hands.context(player, req.params.id);
      const res = await teacher.chat(decisionInput(ctx, req.params.decisionId), messages, playerKey(player));
      if (res.status === 'ok') {
        await hands.addCoachMessages(ctx, req.params.decisionId, [
          { kind: 'chat', role: 'user', tldr: null, content: messages.at(-1)!.content, points: null, ungrounded: null },
          { kind: 'chat', role: 'assistant', tldr: res.tldr, content: res.reply, points: null, ungrounded: res.ungroundedNumbers.length ? res.ungroundedNumbers : null },
        ]);
      }
      return res;
    },
  );

  app.get<{ Params: { id: string; decisionId: string } }>('/api/hands/:id/decisions/:decisionId/star', async (req): Promise<DecisionStar> => {
    const ctx = await hands.context(await players.player(req), req.params.id);
    return hands.star(ctx, req.params.decisionId);
  });

  app.put<{ Params: { id: string; decisionId: string }; Body: StarRequest }>(
    '/api/hands/:id/decisions/:decisionId/star',
    { schema: { body: starSchema } },
    async (req): Promise<DecisionStar> => {
      const ctx = await hands.context(await players.player(req), req.params.id);
      const note = req.body.note?.trim() || null;
      const star: DecisionStar = req.body.starred ? { starred: true, note } : { starred: false, note: null };
      await hands.setStar(ctx, req.params.decisionId, star);
      return star;
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/review',
    { schema: { params: { type: 'object', properties: { sessionId: sessionIdSchema } } } },
    async (req): Promise<SessionReviewResponse> => {
      const player = await players.player(req);
      const records = await hands.sessionHands(player, req.params.sessionId);
      const stats = computeSessionStats(records, records.some((h) => h.config.easyFoldsSkipped));
      if (stats.decisions < MIN_DECISIONS_FOR_REVIEW) {
        return { stats, coach: { status: 'not_enough_data', needed: MIN_DECISIONS_FOR_REVIEW - stats.decisions } };
      }
      // A review is paid for once per decision count; after that it comes from the database.
      const saved = await hands.savedReview(player, req.params.sessionId, stats.decisions);
      if (saved) return { stats, coach: saved };
      const coach = await teacher.review(req.params.sessionId, stats, playerKey(player));
      // Reviews with invented numbers aren't kept, so opening the review again can replace them.
      if (coach.status === 'ok' && coach.ungroundedNumbers.length === 0) await hands.saveReview(player, req.params.sessionId, stats, coach);
      return { stats, coach };
    },
  );

  /** The signed-in account (or null for guests). */
  app.get('/api/me', async (req): Promise<MeResponse> => {
    const user = await players.user(req);
    return { user: user && { id: user.userId, email: user.email, name: user.name } };
  });

  /** Profile routes are for signed-in accounts: a guest's data only lasts one session. */
  const signedIn = async (req: Parameters<typeof players.user>[0]) => {
    const user = await players.user(req);
    if (!user) throw new HttpError(401, 'Sign in to see your profile.');
    return user;
  };

  app.get('/api/me/profile', async (req): Promise<ProfileResponse> => {
    const { userId } = await signedIn(req);
    const { decisions } = await hands.playerDecisions(userId, PROFILE_DECISIONS);
    return {
      stats: computeSessionStats([{ decisions }], false),
      style: styleOf(decisions),
      gto: gtoSummaryOf(decisions),
      starredCount: await hands.starredCount(userId),
    };
  });

  app.get('/api/me/profile/review', async (req): Promise<ProfileReviewResponse> => {
    const { userId } = await signedIn(req);
    const { decisions, total } = await hands.playerDecisions(userId, PROFILE_DECISIONS);
    if (total < MIN_DECISIONS_FOR_REVIEW) return { coach: { status: 'not_enough_data', needed: MIN_DECISIONS_FOR_REVIEW - total } };
    // Written once, then kept until enough new decisions have been played to say something new.
    const saved = await hands.profileReview(userId);
    if (saved && total - saved.decisionsCount < PROFILE_REVIEW_EVERY) return { coach: saved.coach };
    const stats = computeSessionStats([{ decisions }], false);
    const coach = await teacher.review(`profile-${userId}`, stats, playerKey({ kind: 'user', userId }), 'all-time');
    // Reviews with invented numbers aren't kept, so the next visit can replace them.
    if (coach.status === 'ok' && coach.ungroundedNumbers.length === 0) await hands.saveProfileReview(userId, total, stats, coach);
    // A failed refresh still shows the last good review.
    return { coach: coach.status === 'ok' || !saved ? coach : saved.coach };
  });

  app.get<{ Querystring: { before?: string; limit?: number } }>(
    '/api/me/starred',
    {
      schema: {
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { before: { type: 'string', format: 'date-time' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
        },
      },
    },
    async (req): Promise<StarredResponse> => {
      const { userId } = await signedIn(req);
      const limit = req.query.limit ?? 50;
      const rows = await hands.starred(userId, req.query.before ? new Date(req.query.before) : null, limit);
      return {
        items: rows.map((r) => ({ handId: r.handId, decision: r.decision, note: r.note, starredAt: r.starredAt.toISOString() })),
        nextBefore: rows.length === limit ? rows.at(-1)!.starredAt.toISOString() : null,
      };
    },
  );

  /** After sign-in: move this browser's guest data into the account. */
  app.post<{ Body: { guestId: string } }>(
    '/api/me/claim-guest',
    { schema: { body: { type: 'object', required: ['guestId'], additionalProperties: false, properties: { guestId: { type: 'string', format: 'uuid' } } } } },
    async (req) => {
      const user = await players.user(req);
      if (!user) throw new HttpError(401, 'Sign in first.');
      await hands.claimGuest(req.body.guestId.toLowerCase(), user.userId);
      return { ok: true };
    },
  );

  /** Deletes the account and, through the database's cascades, all of its data. */
  app.delete('/api/me', async (req) => {
    const user = await players.user(req);
    if (!user) throw new HttpError(401, 'Sign in first.');
    if (!accounts) throw new HttpError(501, 'Account deletion is not configured on this server.');
    await accounts.deleteUser(user.userId);
    return { ok: true };
  });

  app.get<{ Params: { nodeKey: string } }>('/api/charts/:nodeKey', async (req): Promise<ChartNodeView> => {
    if (isFlopNodeKey(req.params.nodeKey)) {
      const view = engine.flopChartView(req.params.nodeKey);
      if (!view) throw new HttpError(404, 'Flop strategy not found.');
      return view;
    }
    if (!charts.hasNode(req.params.nodeKey)) throw new HttpError(404, 'Chart node not found.');
    return charts.toView(charts.getNode(req.params.nodeKey));
  });

  return app;
}
