import type { HandView, SubmitDecisionResponse } from '@gtotutor/shared-types';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { HandEngine, HandStore } from '../src/engine/handEngine.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { seededRng } from '../src/poker/rng.js';
import { LlmTeacher } from '../src/teacher/llmTeacher.js';

process.env.LOG_LEVEL = 'silent';
const charts = new ChartService(buildFixtureChartSet());
const app = buildApp({
  charts,
  engine: new HandEngine(charts, seededRng(11), runoutResolver),
  store: new HandStore(),
  teacher: new LlmTeacher(async () => ({ explanationText: 'Grounded explanation.', keyFactors: ['Position'] }), 'test', 50),
});
afterAll(() => app.close());

describe('HTTP API', () => {
  it('plays a full hand: start -> decisions -> result -> explanation', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/hands', payload: { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'BTN' } });
    expect(start.statusCode).toBe(200);
    let hand = start.json<HandView>();
    expect(hand.heroCards).toHaveLength(2);
    expect(hand.dataSource.kind).toBe('fixture');

    while (hand.status === 'awaiting_hero') {
      const res = await app.inject({ method: 'POST', url: `/api/hands/${hand.id}/decisions`, payload: { action: hand.legalActions[0].id } });
      expect(res.statusCode).toBe(200);
      const body = res.json<SubmitDecisionResponse>();
      expect(body.feedback.options.length).toBeGreaterThan(1);
      hand = body.hand;
    }
    expect(hand.result).not.toBeNull();

    const decisionId = hand.decisions[0].id;
    const exp = await app.inject({ method: 'GET', url: `/api/hands/${hand.id}/decisions/${decisionId}/explanation` });
    expect(exp.json()).toMatchObject({ status: 'ok', explanationText: 'Grounded explanation.' });

    const chart = await app.inject({ method: 'GET', url: `/api/charts/${encodeURIComponent(hand.decisions[0].nodeKey)}` });
    expect(Object.keys(chart.json().strategy)).toHaveLength(169);
  });

  it('validates input and reports clean errors', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/hands', payload: { tableSize: 'SIX_MAX', stackDepthBb: 77, heroPosition: 'BTN' } });
    expect(bad.statusCode).toBe(400);
    const unsupported = await app.inject({ method: 'POST', url: '/api/hands', payload: { tableSize: 'HU', stackDepthBb: 100, heroPosition: 'BTN' } });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json().error).toMatch(/6-max/);
    const missing = await app.inject({ method: 'GET', url: '/api/hands/nope' });
    expect(missing.statusCode).toBe(404);
  });
});
