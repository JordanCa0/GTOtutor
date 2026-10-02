import {
  CHAT_LIMITS,
  MIN_DECISIONS_FOR_REVIEW,
  type ChartNodeView,
  type ChatRequest,
  type ChatResponse,
  type ExplanationResponse,
  type HandView,
  type HintResponse,
  type SessionReviewResponse,
  type StartHandRequest,
  type SubmitDecisionRequest,
  type SubmitDecisionResponse,
} from '@gtotutor/shared-types';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ChartService } from './charts/chartService.js';
import { HttpError, isFlopNodeKey, type HandEngine, type HandState, type HandStore } from './engine/handEngine.js';
import type { SessionStore } from './engine/sessionStore.js';
import type { ExplainInput, LlmTeacher, SpotContext } from './teacher/llmTeacher.js';
import { computeSessionStats } from './teacher/sessionStats.js';

export interface AppDeps {
  charts: ChartService;
  engine: HandEngine;
  store: HandStore;
  sessions: SessionStore;
  teacher: LlmTeacher;
}

const sessionIdSchema = { type: 'string', pattern: '^[A-Za-z0-9-]{8,64}$' } as const;

const startHandSchema = {
  type: 'object',
  required: ['tableSize', 'stackDepthBb', 'heroPosition'],
  additionalProperties: false,
  properties: {
    tableSize: { enum: ['HU', 'SIX_MAX', 'NINE_MAX'] },
    stackDepthBb: { enum: [20, 40, 60, 100, 150] },
    heroPosition: { enum: ['random', 'UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] },
    sessionId: sessionIdSchema,
    skipEasyFolds: { type: 'boolean' },
  },
} as const;

const decisionSchema = {
  type: 'object',
  required: ['action'],
  additionalProperties: false,
  properties: { action: { enum: ['fold', 'check', 'call', 'raise', 'allin'] } },
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
        properties: { role: { enum: ['user', 'assistant'] }, content: { type: 'string', minLength: 1, maxLength: 4000 } },
      },
    },
  },
} as const;

export function buildApp({ charts, engine, store, sessions, teacher }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    const e = err as { validation?: unknown; message?: string };
    if (e.validation) return reply.status(400).send({ error: e.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  });

  const baseSpot = (state: HandState, spot: { nodeKey: string; nodeLabel: string; board: string[]; approxFlop: string | null }) => ({
    nodeKey: spot.nodeKey,
    nodeLabel: spot.nodeLabel,
    heroPosition: state.heroPosition,
    stackDepthBb: state.config.stackDepthBb,
    rangeSummary: engine.rangeSummary(spot.nodeKey),
    board: spot.board,
    approxFlop: spot.approxFlop,
    dataSource: charts.dataSource,
  });

  const decisionInput = (state: HandState, decisionId: string): ExplainInput => {
    const k = state.decisions.findIndex((d) => d.id === decisionId);
    if (k < 0) throw new HttpError(404, 'Decision not found.');
    const decision = state.decisions[k];
    // The k-th hero entry in the log is this decision; everything before it is the context.
    let heroSeen = 0;
    const cut = state.actionLog.findIndex((a) => a.isHero && heroSeen++ === k);
    return {
      ...baseSpot(state, decision),
      decision,
      heroCards: decision.heroCards,
      handClass: decision.handClass,
      options: decision.options,
      actionsBefore: state.actionLog.slice(0, cut),
      priorDecisions: state.decisions.slice(0, k),
    };
  };

  app.get('/api/health', async () => ({ ok: true }));

  app.post<{ Body: StartHandRequest }>('/api/hands', { schema: { body: startHandSchema } }, async (req): Promise<HandView> => {
    const state = engine.start(req.body);
    store.save(state);
    sessions.add(state);
    return engine.view(state);
  });

  app.get<{ Params: { id: string } }>('/api/hands/:id', async (req): Promise<HandView> => engine.view(store.get(req.params.id)));

  app.post<{ Params: { id: string }; Body: SubmitDecisionRequest }>(
    '/api/hands/:id/decisions',
    { schema: { body: decisionSchema } },
    async (req): Promise<SubmitDecisionResponse> => {
      const state = store.get(req.params.id);
      const feedback = engine.decide(state, req.body.action);
      return { feedback, hand: engine.view(state) };
    },
  );

  app.get<{ Params: { id: string } }>('/api/hands/:id/hint', async (req): Promise<HintResponse> => {
    const state = store.get(req.params.id);
    const pending = engine.pendingDecision(state);
    if (!pending) throw new HttpError(409, 'There is no pending decision to hint at.');
    const spot: SpotContext = {
      ...baseSpot(state, { ...pending, board: state.board }),
      heroCards: pending.heroCards,
      handClass: pending.handClass,
      options: pending.options,
      actionsBefore: state.actionLog,
      priorDecisions: state.decisions,
    };
    const res = await teacher.hint(spot, req.ip);
    if (res.status === 'ok') engine.markHintUsed(state);
    return res;
  });

  app.get<{ Params: { id: string; decisionId: string } }>(
    '/api/hands/:id/decisions/:decisionId/explanation',
    async (req): Promise<ExplanationResponse> => teacher.explain(decisionInput(store.get(req.params.id), req.params.decisionId), req.ip),
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
      return teacher.chat(decisionInput(store.get(req.params.id), req.params.decisionId), messages, req.ip);
    },
  );

  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/review',
    { schema: { params: { type: 'object', properties: { sessionId: sessionIdSchema } } } },
    async (req): Promise<SessionReviewResponse> => {
      const hands = sessions.hands(req.params.sessionId);
      const stats = computeSessionStats(hands, hands.some((h) => h.easyFoldsSkipped));
      const coach =
        stats.decisions < MIN_DECISIONS_FOR_REVIEW
          ? ({ status: 'not_enough_data', needed: MIN_DECISIONS_FOR_REVIEW - stats.decisions } as const)
          : await teacher.review(req.params.sessionId, stats, req.ip);
      return { stats, coach };
    },
  );

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
