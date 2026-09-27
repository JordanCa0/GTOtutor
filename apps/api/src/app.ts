import type {
  ChartNodeView,
  ExplanationResponse,
  HandView,
  StartHandRequest,
  SubmitDecisionRequest,
  SubmitDecisionResponse,
} from '@gtotutor/shared-types';
import Fastify, { type FastifyInstance } from 'fastify';
import type { ChartService } from './charts/chartService.js';
import { HttpError, type HandEngine, type HandStore } from './engine/handEngine.js';
import type { LlmTeacher } from './teacher/llmTeacher.js';

export interface AppDeps {
  charts: ChartService;
  engine: HandEngine;
  store: HandStore;
  teacher: LlmTeacher;
}

const startHandSchema = {
  type: 'object',
  required: ['tableSize', 'stackDepthBb', 'heroPosition'],
  additionalProperties: false,
  properties: {
    tableSize: { enum: ['HU', 'SIX_MAX', 'NINE_MAX'] },
    stackDepthBb: { enum: [20, 40, 60, 100, 150] },
    heroPosition: { enum: ['random', 'UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] },
  },
} as const;

const decisionSchema = {
  type: 'object',
  required: ['action'],
  additionalProperties: false,
  properties: { action: { enum: ['fold', 'call', 'raise', 'allin'] } },
} as const;

export function buildApp({ charts, engine, store, teacher }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    const e = err as { validation?: unknown; message?: string };
    if (e.validation) return reply.status(400).send({ error: e.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  app.post<{ Body: StartHandRequest }>('/api/hands', { schema: { body: startHandSchema } }, async (req): Promise<HandView> => {
    const state = engine.start(req.body);
    store.save(state);
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

  app.get<{ Params: { id: string; decisionId: string } }>(
    '/api/hands/:id/decisions/:decisionId/explanation',
    async (req): Promise<ExplanationResponse> => {
      const state = store.get(req.params.id);
      const k = state.decisions.findIndex((d) => d.id === req.params.decisionId);
      if (k < 0) throw new HttpError(404, 'Decision not found.');
      const decision = state.decisions[k];
      // The k-th hero entry in the log is this decision; everything before it is the context.
      let heroSeen = 0;
      const cut = state.actionLog.findIndex((a) => a.isHero && heroSeen++ === k);
      const node = charts.getNode(decision.nodeKey);
      const shares = charts.rangeSummary(node);
      return teacher.explain(
        {
          decision,
          actionsBefore: state.actionLog.slice(0, cut),
          heroPosition: state.heroPosition,
          stackDepthBb: state.config.stackDepthBb,
          rangeSummary: node.actions.map((a, i) => ({ label: a.label, share: shares[i] })),
          dataSource: charts.dataSource,
        },
        req.ip,
      );
    },
  );

  app.get<{ Params: { nodeKey: string } }>('/api/charts/:nodeKey', async (req): Promise<ChartNodeView> => {
    if (!charts.hasNode(req.params.nodeKey)) throw new HttpError(404, 'Chart node not found.');
    return charts.toView(charts.getNode(req.params.nodeKey));
  });

  return app;
}
