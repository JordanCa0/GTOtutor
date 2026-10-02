import type { ActionType } from '@gtotutor/shared-types';
import { describe, expect, it } from 'vitest';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { HandEngine, HttpError } from '../src/engine/handEngine.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { handClass } from '../src/poker/cards.js';
import { seededRng } from '../src/poker/rng.js';

const charts = new ChartService(buildFixtureChartSet());
const newEngine = (seed: number) => new HandEngine(charts, seededRng(seed), runoutResolver);
const req = { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'random' } as const;

describe('hand engine', () => {
  it('plays thousands of random hands to completion with consistent accounting', () => {
    const engine = newEngine(42);
    const rng = seededRng(99);
    let showdowns = 0;
    for (let i = 0; i < 3000; i++) {
      const state = engine.start(req);
      let view = engine.view(state);
      expect(view.status).toBe('awaiting_hero');
      let guard = 0;
      while (view.status === 'awaiting_hero') {
        const legal = view.legalActions;
        const action = legal[rng.int(legal.length)].id as ActionType;
        engine.decide(state, action);
        view = engine.view(state);
        if (++guard > 10) throw new Error('hand did not terminate');
      }
      const r = view.result!;
      const committed = view.seats.reduce((s, seat) => s + seat.committedBb, 0);
      expect(r.potBb).toBeCloseTo(committed, 5);
      const hero = view.seats.find((s) => s.isHero)!;
      expect(r.heroNetBb).toBeGreaterThanOrEqual(-hero.committedBb - 1e-9);
      expect(r.heroNetBb).toBeLessThanOrEqual(r.potBb - hero.committedBb + 1e-9);
      expect(view.decisions.length).toBeGreaterThan(0);
      if (r.showdown) {
        showdowns++;
        expect(r.board).toHaveLength(5);
        const allCards = [...r.board, ...r.showdown.flatMap((s) => s.cards)];
        expect(new Set(allCards).size).toBe(allCards.length);
      }
    }
    expect(showdowns).toBeGreaterThan(100);
  });

  it('seats hero where requested and hides villain cards until showdown', () => {
    const engine = newEngine(3);
    const state = engine.start({ ...req, heroPosition: 'CO' });
    const view = engine.view(state);
    expect(view.heroPosition).toBe('CO');
    expect(view.seats.filter((s) => s.cards !== null).map((s) => s.position)).toEqual(['CO']);
  });

  it('grades pure folds: folding is best, opening is a mistake', () => {
    const engine = newEngine(5);
    const rfi = charts.getNode('SIX_MAX|100|RFI|UTG');
    const grades = new Set<string>();
    for (let i = 0; i < 200 && grades.size < 2; i++) {
      const state = engine.start({ ...req, heroPosition: 'UTG', skipEasyFolds: false });
      const [c1, c2] = engine.view(state).heroCards;
      if (rfi.strategy.get(handClass(c1, c2))![0] !== 1) continue;
      const choice = i % 2 === 0 ? 'fold' : 'raise';
      const { grade } = engine.decide(state, choice);
      expect(grade).toBe(choice === 'fold' ? 'best' : 'mistake');
      grades.add(grade);
    }
    expect(grades).toEqual(new Set(['best', 'mistake']));
  });

  it('mostly skips hands whose first decision is an easy fold', () => {
    const easyFoldShare = (skipEasyFolds: boolean) => {
      const engine = newEngine(21);
      let easy = 0;
      const n = 1000;
      for (let i = 0; i < n; i++) {
        const pending = engine.pendingDecision(engine.start({ ...req, skipEasyFolds }))!;
        if ((pending.options.find((o) => o.actionId === 'fold')?.frequency ?? 0) >= 0.98) easy++;
      }
      return easy / n;
    };
    const unfiltered = easyFoldShare(false);
    const filtered = easyFoldShare(true);
    expect(unfiltered).toBeGreaterThan(0.5);
    expect(filtered).toBeLessThan(0.15);
    expect(filtered).toBeGreaterThan(0); // some folds are still dealt on purpose
  });

  it('lets the SB limp: the BB either checks it down or raises and the SB faces the iso-raise', () => {
    const engine = newEngine(31);
    const seen = new Set<string>();
    for (let i = 0; i < 600 && seen.size < 2; i++) {
      const state = engine.start({ ...req, heroPosition: 'SB', skipEasyFolds: false });
      if (engine.pendingDecision(state)!.nodeKey !== 'SIX_MAX|100|RFI|SB') continue;
      expect(engine.view(state).legalActions.map((a) => a.label)).toEqual(['Fold', 'Limp', 'Raise to 3']);
      engine.decide(state, 'call');
      const view = engine.view(state);
      if (view.status === 'complete') {
        expect(view.actionLog.slice(-2)).toMatchObject([
          { position: 'SB', action: 'call', toBb: 1 },
          { position: 'BB', action: 'check', toBb: 1 },
        ]);
        expect(view.result!.potBb).toBe(2);
        expect(view.result!.board).toHaveLength(5);
        seen.add('checked');
      } else {
        expect(view.pendingSpot!.nodeKey).toBe('SIX_MAX|100|VS_ISO|SB|BB');
        expect(view.legalActions.map((a) => a.label)).toEqual(['Fold', 'Call 3.5', '3-bet to 11']);
        seen.add('iso-raised');
      }
    }
    expect(seen).toEqual(new Set(['checked', 'iso-raised']));
  });

  it('gives the BB a check-or-raise spot (no fold) after an SB limp', () => {
    const engine = newEngine(32);
    for (let i = 0; i < 2000; i++) {
      const state = engine.start({ ...req, heroPosition: 'BB', skipEasyFolds: false });
      if (engine.pendingDecision(state)!.nodeKey !== 'SIX_MAX|100|VS_LIMP|BB|SB') continue;
      expect(engine.view(state).legalActions.map((a) => a.id)).toEqual(['check', 'raise']);
      engine.decide(state, 'check');
      const view = engine.view(state);
      expect(view.status).toBe('complete');
      expect(view.result!.potBb).toBe(2);
      return;
    }
    throw new Error('never dealt an SB limp to a BB hero');
  });

  it('rejects illegal and out-of-turn actions', () => {
    const engine = newEngine(8);
    const state = engine.start({ ...req, heroPosition: 'UTG' });
    expect(() => engine.decide(state, 'allin')).toThrow(HttpError);
    engine.decide(state, 'fold');
    expect(() => engine.decide(state, 'fold')).toThrow(/not your turn/);
  });

  it('rejects configurations without charts yet', () => {
    expect(() => newEngine(1).start({ ...req, tableSize: 'NINE_MAX' })).toThrow(/Only 6-max/);
  });
});
