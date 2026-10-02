import type { HandView, SessionReviewResponse, SubmitDecisionResponse } from '@gtotutor/shared-types';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { HandEngine, HandStore } from '../src/engine/handEngine.js';
import { SessionStore } from '../src/engine/sessionStore.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { seededRng } from '../src/poker/rng.js';
import { LlmTeacher, type CoachLlm } from '../src/teacher/llmTeacher.js';
import { fakeLlm, unavailableLlm } from './fakes.js';

process.env.LOG_LEVEL = 'silent';
const charts = new ChartService(buildFixtureChartSet());

function makeApp(llm: CoachLlm) {
  return buildApp({
    charts,
    engine: new HandEngine(charts, seededRng(11), runoutResolver),
    store: new HandStore(),
    sessions: new SessionStore(),
    teacher: new LlmTeacher(llm, 'test', 50),
  });
}

const app = makeApp(
  fakeLlm({
    structured: () => ({ tldr: 'Correct: grounded explanation.', points: ['Position.', 'Price.'], detail: 'Think about position and blockers.', summary: 'Solid session.', leaks: [], drill: 'Play BB hands.' }),
    text: 'Think about position and blockers.',
  }),
);
const offline = makeApp(unavailableLlm('Claude API key is not configured.'));
afterAll(() => Promise.all([app.close(), offline.close()]));

const SESSION = 'test-session-0001';

async function playHand(target = app, sessionId = SESSION): Promise<HandView> {
  const start = await target.inject({ method: 'POST', url: '/api/hands', payload: { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'random', sessionId } });
  expect(start.statusCode).toBe(200);
  let hand = start.json<HandView>();
  while (hand.status === 'awaiting_hero') {
    const res = await target.inject({ method: 'POST', url: `/api/hands/${hand.id}/decisions`, payload: { action: hand.legalActions[0].id } });
    expect(res.statusCode).toBe(200);
    hand = res.json<SubmitDecisionResponse>().hand;
  }
  return hand;
}

describe('HTTP API', () => {
  it('plays a full hand: start -> decisions -> result -> explanation -> chart', async () => {
    const hand = await playHand();
    expect(hand.result).not.toBeNull();
    expect(hand.pendingSpot).toBeNull();
    const decisionId = hand.decisions[0].id;
    const exp = await app.inject({ method: 'GET', url: `/api/hands/${hand.id}/decisions/${decisionId}/explanation` });
    expect(exp.json()).toMatchObject({ status: 'ok', tldr: 'Correct: grounded explanation.', points: ['Position.', 'Price.'] });
    const chart = await app.inject({ method: 'GET', url: `/api/charts/${encodeURIComponent(hand.decisions[0].nodeKey)}` });
    expect(Object.keys(chart.json().strategy)).toHaveLength(169);
  });

  it('gives a hint for the pending decision and records that it was used', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/hands', payload: { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'BTN' } });
    const hand = start.json<HandView>();
    expect(hand.pendingSpot?.handClass).toBeTruthy();
    const hint = await app.inject({ method: 'GET', url: `/api/hands/${hand.id}/hint` });
    expect(hint.json()).toMatchObject({ status: 'ok', hint: 'Think about position and blockers.' });
    const res = await app.inject({ method: 'POST', url: `/api/hands/${hand.id}/decisions`, payload: { action: 'fold' } });
    expect(res.json<SubmitDecisionResponse>().feedback.hintUsed).toBe(true);
    const late = await app.inject({ method: 'GET', url: `/api/hands/${hand.id}/hint` });
    expect(late.statusCode).toBe(409);
  });

  it('answers follow-up questions and validates the conversation', async () => {
    const hand = await playHand();
    const url = `/api/hands/${hand.id}/decisions/${hand.decisions[0].id}/chat`;
    const ok = await app.inject({ method: 'POST', url, payload: { messages: [{ role: 'user', content: 'Why?' }] } });
    expect(ok.json()).toMatchObject({ status: 'ok', tldr: 'Correct: grounded explanation.', reply: 'Think about position and blockers.' });
    const withTldr = await app.inject({ method: 'POST', url, payload: { messages: [{ role: 'user', content: 'Why?' }, { role: 'assistant', tldr: 'Short.', content: 'Long.' }, { role: 'user', content: 'And?' }] } });
    expect(withTldr.statusCode).toBe(200);
    const tooLong = await app.inject({ method: 'POST', url, payload: { messages: [{ role: 'user', content: 'x'.repeat(501) }] } });
    expect(tooLong.statusCode).toBe(400);
    const endsWithAssistant = await app.inject({ method: 'POST', url, payload: { messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] } });
    expect(endsWithAssistant.statusCode).toBe(400);
    const tooMany = Array.from({ length: 21 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'q' }));
    expect((await app.inject({ method: 'POST', url, payload: { messages: tooMany } })).statusCode).toBe(400);
  });

  it('reviews a session: stats always, coach summary once there are enough decisions', async () => {
    const session = 'review-session-01';
    await playHand(app, session);
    const early = (await app.inject({ method: 'GET', url: `/api/sessions/${session}/review` })).json<SessionReviewResponse>();
    expect(early.coach.status).toBe('not_enough_data');
    for (let i = 0; i < 6; i++) await playHand(app, session);
    const review = (await app.inject({ method: 'GET', url: `/api/sessions/${session}/review` })).json<SessionReviewResponse>();
    expect(review.stats.hands).toBe(7);
    expect(review.stats.easyFoldsSkipped).toBe(true);
    expect(review.coach).toMatchObject({ status: 'ok', summary: 'Solid session.' });
  });

  it('still returns stats when the coach is unavailable', async () => {
    const session = 'offline-session-1';
    for (let i = 0; i < 6; i++) await playHand(offline, session);
    const review = (await offline.inject({ method: 'GET', url: `/api/sessions/${session}/review` })).json<SessionReviewResponse>();
    expect(review.stats.decisions).toBeGreaterThanOrEqual(6);
    expect(review.coach).toEqual({ status: 'unavailable', reason: 'Claude API key is not configured.' });
  });

  it('validates input and reports clean errors', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/hands', payload: { tableSize: 'SIX_MAX', stackDepthBb: 77, heroPosition: 'BTN' } });
    expect(bad.statusCode).toBe(400);
    const unsupported = await app.inject({ method: 'POST', url: '/api/hands', payload: { tableSize: 'HU', stackDepthBb: 100, heroPosition: 'BTN' } });
    expect(unsupported.statusCode).toBe(400);
    expect(unsupported.json().error).toMatch(/6-max/);
    const badSession = await app.inject({ method: 'POST', url: '/api/hands', payload: { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'BTN', sessionId: '../../x' } });
    expect(badSession.statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/hands/nope' })).statusCode).toBe(404);
  });
});
