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

  it('shows the cards of the raise hero folded to, and nothing for a fold with no raise to face', () => {
    const engine = newEngine(8);
    let seen = 0;
    for (let i = 0; i < 300 && seen < 20; i++) {
      const state = engine.start({ ...req, heroPosition: 'BB', skipEasyFolds: false });
      if (!engine.view(state).legalActions.some((a) => a.id === 'fold')) continue;
      engine.decide(state, 'fold');
      const reveal = engine.view(state).result!.foldReveal!;
      const raiser = [...state.actionLog].reverse().find((a) => !a.isHero && a.action !== 'fold' && a.action !== 'call');
      expect(reveal.position).toBe(raiser!.position);
      expect(reveal.cards).toEqual(state.players.find((p) => p.position === reveal.position)!.cards);
      // A hand name only when there is a board (other players can play on after hero folds).
      expect(reveal.handName === null).toBe(engine.view(state).result!.board.length === 0);
      seen++;
    }
    expect(seen).toBe(20);
    // UTG has nothing to fold to.
    const utg = engine.start({ ...req, heroPosition: 'UTG', skipEasyFolds: false });
    engine.decide(utg, 'fold');
    expect(engine.view(utg).result!.foldReveal).toBeNull();
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

  it('lets every position limp first in, and puts the limper vs the BB or an isolator', () => {
    const engine = newEngine(33);
    const seen = new Set<string>();
    for (let i = 0; i < 600 && seen.size < 2; i++) {
      const state = engine.start({ ...req, heroPosition: 'UTG', skipEasyFolds: false });
      expect(engine.view(state).legalActions.map((a) => a.label)).toEqual(['Fold', 'Limp', 'Raise to 2.5']);
      engine.decide(state, 'call');
      const view = engine.view(state);
      if (view.status === 'complete') {
        expect(view.actionLog.find((a) => a.position === 'BB')).toMatchObject({ action: 'check', toBb: 1 });
        expect(view.result!.potBb).toBe(2.5); // UTG 1, BB 1, the SB's folded 0.5
        seen.add('checked');
      } else {
        const iso = view.actionLog.find((a) => a.action === 'raise')!;
        expect(view.pendingSpot!.nodeKey).toBe(`SIX_MAX|100|VS_ISO|UTG|${iso.position}`);
        expect(view.legalActions.map((a) => a.label)).toEqual(['Fold', `Call ${iso.toBb}`, '3-bet to 11']);
        // Everyone behind the isolation raise folded: the pot is UTG vs the isolator.
        expect(view.seats.filter((s) => !s.folded).map((s) => s.position).sort()).toEqual(['UTG', iso.position].sort());
        seen.add('isolated');
      }
    }
    expect(seen).toEqual(new Set(['checked', 'isolated']));
  });

  it('facing a limp: fold or isolate to 4.5, never over-limp; the BB checks or isolates', () => {
    // The placeholders never limp outside the SB, so make UTG always limp here.
    const set = buildFixtureChartSet();
    const rfi = set.nodes.get('SIX_MAX|100|RFI|UTG')!;
    for (const hc of rfi.strategy.keys()) rfi.strategy.set(hc, [0, 1, 0]);
    const engine = new HandEngine(new ChartService(set), seededRng(34), runoutResolver);

    const hj = engine.start({ ...req, heroPosition: 'HJ', skipEasyFolds: false });
    expect(engine.pendingDecision(hj)!.nodeKey).toBe('SIX_MAX|100|VS_LIMP|HJ|UTG');
    expect(engine.view(hj).legalActions.map((a) => a.label)).toEqual(['Fold', 'Raise to 4.5']);

    for (let i = 0; i < 300; i++) {
      const bb = engine.start({ ...req, heroPosition: 'BB', skipEasyFolds: false });
      if (engine.pendingDecision(bb)!.nodeKey !== 'SIX_MAX|100|VS_LIMP|BB|UTG') continue;
      expect(engine.view(bb).legalActions.map((a) => a.label)).toEqual(['Check', 'Raise to 4.5']);
      return;
    }
    throw new Error('never dealt a BB hero facing a UTG limp alone');
  });

  it('folds hero automatically behind an isolation raise, so such hands are redealt', () => {
    // UTG always limps and HJ always isolates: a BTN hero never gets a decision.
    const set = buildFixtureChartSet();
    for (const [key, actions] of [['SIX_MAX|100|RFI|UTG', [0, 1, 0]], ['SIX_MAX|100|VS_LIMP|HJ|UTG', [0, 1]]] as const) {
      const n = set.nodes.get(key)!;
      for (const hc of n.strategy.keys()) n.strategy.set(hc, [...actions]);
    }
    const engine = new HandEngine(new ChartService(set), seededRng(35), runoutResolver);
    expect(() => engine.start({ ...req, heroPosition: 'BTN', skipEasyFolds: false })).toThrow('Could not deal a hand with a hero decision');
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

  it('keeps every pot heads-up: nobody may call once someone has already called', () => {
    const engine = newEngine(11);
    const rng = seededRng(12);
    let blocked = 0;
    for (let i = 0; i < 3000; i++) {
      const state = engine.start(req);
      let view = engine.view(state);
      while (view.status === 'awaiting_hero') {
        if (view.pendingSpot?.nodeKey.endsWith('|nocall')) {
          blocked++;
          expect(view.legalActions.map((a) => a.id)).not.toContain('call');
        }
        engine.decide(state, view.legalActions[rng.int(view.legalActions.length)].id as ActionType);
        view = engine.view(state);
      }
      const preflop = view.actionLog.filter((a) => a.street === 'preflop');
      const folded = new Set(preflop.filter((a) => a.action === 'fold').map((a) => a.position));
      expect(view.seats.filter((s) => !folded.has(s.position)).length).toBeLessThanOrEqual(2);
    }
    expect(blocked).toBeGreaterThan(0);
  });

  it('says why Call is missing: someone already called, or hero faces a limp', () => {
    const engine = newEngine(11);
    const rng = seededRng(12);
    let explained = 0;
    for (let i = 0; i < 3000; i++) {
      const state = engine.start(req);
      let view = engine.view(state);
      while (view.status === 'awaiting_hero') {
        const blocked = view.pendingSpot!.street === 'preflop' && view.pendingSpot!.nodeKey.endsWith('|nocall');
        expect(view.noCallReason != null).toBe(blocked);
        if (blocked) {
          explained++;
          // Facing an open and a caller: a squeeze (3-bet) or fold.
          if (view.pendingSpot!.nodeKey.includes('|VS_OPEN|')) expect(view.noCallReason!.title).toBe('3-bet or fold');
        }
        engine.decide(state, view.legalActions[rng.int(view.legalActions.length)].id as ActionType);
        view = engine.view(state);
      }
    }
    expect(explained).toBeGreaterThan(0);

    // UTG always limps: an HJ hero can only raise or fold, and is told why.
    const set = buildFixtureChartSet();
    const rfi = set.nodes.get('SIX_MAX|100|RFI|UTG')!;
    for (const hc of rfi.strategy.keys()) rfi.strategy.set(hc, [0, 1, 0]);
    const limps = new HandEngine(new ChartService(set), seededRng(34), runoutResolver);
    expect(limps.view(limps.start({ ...req, heroPosition: 'HJ', skipEasyFolds: false })).noCallReason?.title).toBe('Raise or fold');
  });

  it('simple pots: bots never limp or call ahead of hero, so hero can always call a raise', () => {
    const engine = newEngine(21);
    const rng = seededRng(22);
    let facingRaise = 0;
    let calledHero = 0;
    for (let i = 0; i < 3000; i++) {
      const state = engine.start({ ...req, simplePots: true });
      let view = engine.view(state);
      while (view.status === 'awaiting_hero') {
        const spot = view.pendingSpot!;
        if (spot.street === 'preflop') {
          expect(spot.nodeKey).not.toMatch(/\|nocall$/);
          expect(view.noCallReason).toBeNull();
          // The only limp hero ever faces is the SB completing into hero's big blind.
          if (spot.nodeKey.includes('|VS_LIMP|')) expect(spot.nodeKey).toBe('SIX_MAX|100|VS_LIMP|BB|SB');
          else if (!/\|RFI\|/.test(spot.nodeKey)) {
            facingRaise++;
            expect(view.legalActions.map((a) => a.id)).toContain('call');
          }
        }
        engine.decide(state, view.legalActions[rng.int(view.legalActions.length)].id as ActionType);
        view = engine.view(state);
      }
      // Bots still call hero's own raises.
      const preflop = view.actionLog.filter((a) => a.street === 'preflop');
      if (preflop.some((a, j) => !a.isHero && a.action === 'call' && preflop.slice(0, j).some((b) => b.isHero && (b.action === 'raise' || b.action === 'allin')))) calledHero++;
    }
    expect(facingRaise).toBeGreaterThan(300);
    expect(calledHero).toBeGreaterThan(0);

    // UTG always limps in the chart, but folds instead while hero is still to act.
    const set = buildFixtureChartSet();
    const rfi = set.nodes.get('SIX_MAX|100|RFI|UTG')!;
    for (const hc of rfi.strategy.keys()) rfi.strategy.set(hc, [0, 1, 0]);
    const limps = new HandEngine(new ChartService(set), seededRng(34), runoutResolver);
    const hj = limps.start({ ...req, heroPosition: 'HJ', skipEasyFolds: false, simplePots: true });
    expect(hj.actionLog[0]).toMatchObject({ position: 'UTG', action: 'fold' });
    expect(limps.pendingDecision(hj)!.nodeKey).toBe('SIX_MAX|100|RFI|HJ');
  });

  it('plays every hand against the chosen opponent, who never folds its first decision, with everyone else folding', () => {
    const engine = newEngine(21);
    const rng = seededRng(5);
    const cases = [
      ['BB', 'UTG'],
      ['BB', 'BTN'],
      ['BTN', 'CO'],
      ['UTG', 'BTN'],
      ['UTG', 'BB'],
      ['SB', 'BB'],
      ['BB', 'SB'],
    ] as const;
    for (const [heroPosition, opponentPosition] of cases) {
      let opponentActed = 0;
      for (let i = 0; i < 40; i++) {
        const state = engine.start({ ...req, heroPosition, opponentPosition });
        let guard = 0;
        while (state.heroToAct) {
          const legal = engine.view(state).legalActions;
          // Hero never folds first, so an opponent behind hero always gets to answer.
          const choices = state.decisions.length ? legal : legal.filter((a) => a.id !== 'fold');
          engine.decide(state, choices[rng.int(choices.length)].id as ActionType);
          if (++guard > 10) throw new Error('hand did not terminate');
        }
        const first = state.actionLog.find((a) => a.street === 'preflop' && a.position === opponentPosition);
        if (first) {
          opponentActed++;
          expect(first.action, `${heroPosition} vs ${opponentPosition}`).not.toBe('fold');
        }
        // Nobody but hero and the opponent ever puts in more than their blind.
        for (const a of state.actionLog.filter((e) => e.street === 'preflop' && e.position !== heroPosition && e.position !== opponentPosition)) {
          expect(a.action).toMatch(/fold|check/);
        }
      }
      expect(opponentActed, `${heroPosition} vs ${opponentPosition}`).toBeGreaterThan(30);
    }
  });

  it("rejects an opponent without a fixed hero seat, or in hero's seat", () => {
    expect(() => newEngine(1).start({ ...req, heroPosition: 'random', opponentPosition: 'BTN' })).toThrow(/Choose your position/);
    expect(() => newEngine(1).start({ ...req, heroPosition: 'BTN', opponentPosition: 'BTN' })).toThrow(/your seat/);
    expect(newEngine(1).start({ ...req, heroPosition: 'random', opponentPosition: 'any' }).heroToAct).toBe(true);
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
