import type { HandView, SubmitDecisionResponse } from '@gtotutor/shared-types';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { HandEngine } from '../src/engine/handEngine.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { CardMapper, cardStr, mapHand, nearestFlop, parseCards, shapeOf, handIndex } from '../src/postflop/flopMap.js';
import { FlopStore, parseSolverAction } from '../src/postflop/flopStore.js';
import { seededRng } from '../src/poker/rng.js';
import { LlmTeacher } from '../src/teacher/llmTeacher.js';
import { client, fakeLlm, fakeSolverOutput, memoryDeps } from './fakes.js';

describe('flop shapes and nearest flop', () => {
  it('describes suit and pairing patterns independent of card order', () => {
    expect(shapeOf(parseCards('2cKh7h'))).toMatchObject({ pattern: 'aab', pairing: 'U' });
    expect(shapeOf(parseCards('KhKd2h')).pairing).toBe('P');
    expect(shapeOf(parseCards('Kh2d2c')).pairing).toBe('L');
    expect(shapeOf(parseCards('KhKd2h')).pattern).toBe(shapeOf(parseCards('KdKh2d')).pattern);
  });

  it('finds the same flop under a suit swap at distance 0, else the closest same-shape flop', () => {
    expect(nearestFlop(parseCards('Kc7h2d'), ['Kh7d2c', 'Qh7d2c'])).toEqual({ flop: 'Kh7d2c', distance: 0 });
    expect(nearestFlop(parseCards('Kc8h2d'), ['Ah7d2c', 'Kh7d2c', 'Kh7h2c'])!.flop).toBe('Kh7d2c');
    // A monotone flop never maps to a rainbow one.
    expect(nearestFlop(parseCards('Kh7h2h'), ['Kh7d2c'])).toBeNull();
  });

  it('maps hands so they keep their role: pairs stay pairs, flush draws stay flush draws', () => {
    const mapper = new CardMapper(parseCards('Ks8s2d'), parseCards('Kh7h2c'));
    // Top pair keeps the king; the spade flush draw becomes a heart flush draw.
    expect(cardStr(mapper.card(parseCards('Kd')[0]))).toMatch(/^K/);
    expect(mapper.card(parseCards('As')[0])).toEqual(parseCards('Ah')[0]);
    expect(mapper.card(parseCards('8c')[0]).r).toBe(parseCards('7c')[0].r);
    // A rank between the board cards stays between them.
    const nine = mapper.card(parseCards('9c')[0]).r;
    expect(nine).toBeGreaterThan(parseCards('7c')[0].r);
    expect(nine).toBeLessThan(parseCards('Kc')[0].r);
  });

  it('falls back to the closest hand in the range when the exact translation is missing', () => {
    const mapper = new CardMapper(parseCards('Kc7h2d'), parseCards('Kh7d2c'));
    const hands = ['AsAd', 'QsJs', '9s8s'];
    expect(hands[mapHand(parseCards('AhAc'), mapper, hands, handIndex(hands))]).toBe('AsAd');
    expect(hands[mapHand(parseCards('QdJd'), mapper, hands, handIndex(hands))]).toBe('QsJs');
  });

  it('reads solver action labels', () => {
    expect(parseSolverAction('bet 1.8')).toEqual({ id: 'bet', label: 'Bet 1.8', toBb: 1.8 });
    expect(parseSolverAction('check')).toEqual({ id: 'check', label: 'Check', toBb: null });
    expect(parseSolverAction('allin 97.5').id).toBe('allin');
  });
});


describe('flop play from solver output', () => {
  const charts = new ChartService(buildFixtureChartSet());
  const flops = new FlopStore(fakeSolverOutput());

  it('plays BTN vs BB flops from the solved strategy and grades hero against it', () => {
    const engine = new HandEngine(charts, seededRng(7), runoutResolver, flops);
    let played = 0;
    for (let i = 0; i < 3000 && played < 5; i++) {
      const state = engine.start({ tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'BTN', skipEasyFolds: false });
      if (engine.pendingDecision(state)!.nodeKey !== 'SIX_MAX|100|RFI|BTN') continue;
      engine.decide(state, 'raise');
      const view = engine.view(state);
      if (view.status !== 'awaiting_hero' || view.pendingSpot?.street !== 'flop') continue;

      // BB checked (the fake strategy always checks), so BTN chooses between check and bet.
      expect(view.board).toHaveLength(3);
      expect(view.actionLog.at(-1)).toMatchObject({ position: 'BB', action: 'check', street: 'flop' });
      expect(view.legalActions.map((a) => a.label)).toEqual(['Check', 'Bet 1.8']);
      const feedback = engine.decide(state, 'bet');
      expect(feedback.street).toBe('flop');
      expect(feedback.grade).toBe('best'); // 50/50 mix: both actions are top frequency
      expect(feedback.nodeKey).toMatch(/^FLOP\|btn_vs_bb_srp_100\|Kh7d2c\|0$/);

      // BB calls the bet (fake strategy), then the turn and river run out.
      const done = engine.view(state);
      expect(done.status).toBe('complete');
      expect(done.actionLog.slice(-2)).toMatchObject([
        { position: 'BTN', action: 'bet', streetBb: 1.8, toBb: 4.3 },
        { position: 'BB', action: 'call', streetBb: 1.8, toBb: 4.3 },
      ]);
      expect(done.result!.potBb).toBe(9.1);
      expect(done.result!.board.slice(0, 3)).toEqual(view.board);
      expect(done.result!.board).toHaveLength(5);
      expect(engine.rangeSummary(feedback.nodeKey).map((r) => r.label)).toEqual(['Check', 'Bet 1.8']);
      expect(engine.flopChartView(feedback.nodeKey)!.strategy.AA).toEqual([0.5, 0.5]);
      played++;
    }
    expect(played).toBe(5);
  });

  it('flop practice deals straight to hero\'s BTN vs BB flop decision', () => {
    const engine = new HandEngine(charts, seededRng(9), runoutResolver, flops);
    for (const heroPosition of ['BTN', 'BB', 'random'] as const) {
      for (let i = 0; i < 5; i++) {
        const state = engine.start({ tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition, flopPractice: true });
        const view = engine.view(state);
        expect(view.pendingSpot!.street).toBe('flop');
        expect(['BTN', 'BB']).toContain(view.heroPosition);
        if (heroPosition !== 'random') expect(view.heroPosition).toBe(heroPosition);
        expect(view.decisions).toEqual([]);
        expect(view.actionLog.filter((a) => a.street === 'preflop').map((a) => `${a.position} ${a.action}`)).toEqual([
          'UTG fold',
          'HJ fold',
          'CO fold',
          'BTN raise',
          'SB fold',
          'BB call',
        ]);
        expect(view.potBb).toBe(5.5);
      }
    }
  });

  it('runs hands out after preflop when the spot has no solved flops', () => {
    const engine = new HandEngine(charts, seededRng(8), runoutResolver, flops);
    for (let i = 0; i < 300; i++) {
      const state = engine.start({ tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'UTG', skipEasyFolds: false });
      engine.decide(state, engine.pendingDecision(state)!.options[0].actionId);
      while (engine.pendingDecision(state)) engine.decide(state, engine.pendingDecision(state)!.options[0].actionId);
      expect(state.decisions.every((d) => d.street === 'preflop')).toBe(true);
    }
  });
});

describe('flop play over HTTP', () => {
  process.env.LOG_LEVEL = 'silent';
  const charts = new ChartService(buildFixtureChartSet());
  const httpEngine = new HandEngine(charts, seededRng(12), runoutResolver, new FlopStore(fakeSolverOutput()));
  const app = buildApp({
    charts,
    engine: httpEngine,
    ...memoryDeps(httpEngine),
    teacher: new LlmTeacher(fakeLlm({ structured: () => ({ tldr: 'Correct: fine.', points: ['A.', 'B.'] }), text: 'Hint.' }), 'test', 50),
  });
  afterAll(() => app.close());
  const call = client(app);

  it('accepts every flop action, including bet, and serves the flop strategy and coach', async () => {
    for (const action of ['bet', 'check'] as const) {
      const start = await call({ method: 'POST', url: '/api/hands', payload: { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'BTN', flopPractice: true } });
      expect(start.statusCode).toBe(200);
      const hand = start.json<HandView>();
      expect(hand.legalActions.map((a) => a.id)).toContain(action);
      const res = await call({ method: 'POST', url: `/api/hands/${hand.id}/decisions`, payload: { action } });
      expect(res.statusCode).toBe(200);
      const { feedback } = res.json<SubmitDecisionResponse>();
      expect(feedback.chosenAction).toBe(action);
      const chart = await call({ method: 'GET', url: `/api/charts/${encodeURIComponent(feedback.nodeKey)}` });
      expect(chart.statusCode).toBe(200);
      const coach = await call({ method: 'GET', url: `/api/hands/${hand.id}/decisions/${feedback.id}/explanation` });
      expect(coach.json()).toMatchObject({ status: 'ok' });
    }
  });
});
