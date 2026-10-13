import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionLogEntry, ActionType } from '@gtotutor/shared-types';
import { describe, expect, it } from 'vitest';
import { ArchetypeService, JEV_WEIGHT } from '../src/archetypes/archetypeService.js';
import { chenScore, combos, ruleFrequencies } from '../src/archetypes/archetypes.js';
import { describeHand } from '../src/archetypes/handReading.js';
import { jevClient, type JevClient } from '../src/archetypes/jevClient.js';
import { actionHistory } from '../src/archetypes/postflopQuestion.js';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { makeNodeKey } from '../src/charts/nodeKeys.js';
import { MemoryRepo } from '../src/db/repo.js';
import { HandEngine } from '../src/engine/handEngine.js';
import { HandService } from '../src/engine/handService.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { FlopStore } from '../src/postflop/flopStore.js';
import { ALL_HAND_CLASSES } from '../src/poker/cards.js';
import { seededRng } from '../src/poker/rng.js';
import { fakeSolverOutput } from './fakes.js';

const charts = new ChartService(buildFixtureChartSet());
const rfi = charts.getNode(makeNodeKey('SIX_MAX', 100, 'RFI', 'CO'));
const foldIdx = rfi.actions.findIndex((a) => a.id === 'fold');
/** Combos-unweighted share of hand classes played (not folded). */
const playRate = (freqs: (hc: string) => number[]) => ALL_HAND_CLASSES.reduce((s, hc) => s + 1 - freqs(hc)[foldIdx], 0) / ALL_HAND_CLASSES.length;

/** A fake Jev that always answers `answer` (option name -> probability) for every question. */
function fakeJev(answer: (names: string[]) => Record<string, number>): JevClient & { calls: number } {
  const jev = {
    calls: 0,
    async choose(_state: Record<string, unknown>, questions: Record<string, { criteria: Record<string, string> }>) {
      jev.calls++;
      return Object.fromEntries(Object.entries(questions).map(([hc, q]) => [hc, answer(Object.keys(q.criteria))]));
    },
  };
  return jev;
}

describe('archetype rules', () => {
  it('scores hands with the Chen formula', () => {
    expect(chenScore('AA')).toBe(20);
    expect(chenScore('AKs')).toBe(12);
    expect(chenScore('22')).toBe(5);
    expect(chenScore('72o')).toBe(-1);
    expect(chenScore('JTs')).toBe(9);
  });

  it('keeps frequencies summing to 1 for every hand and archetype', () => {
    for (const arch of ['fish', 'nit', 'lag', 'tag'] as const) {
      for (const hc of ALL_HAND_CLASSES) {
        const f = ruleFrequencies(arch, rfi, hc);
        expect(f.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
        expect(f.every((x) => x >= 0)).toBe(true);
      }
    }
  });

  it('plays fish and LAGs looser than the chart, nits tighter', () => {
    const chart = playRate((hc) => rfi.strategy.get(hc)!);
    const rate = (arch: 'fish' | 'nit' | 'lag') => playRate((hc) => ruleFrequencies(arch, rfi, hc));
    expect(rate('fish')).toBeGreaterThan(chart + 0.1);
    expect(rate('lag')).toBeGreaterThan(chart);
    expect(rate('nit')).toBeLessThan(chart - 0.05);
    // A nit still plays aces.
    expect(ruleFrequencies('nit', rfi, 'AA')[foldIdx]).toBeLessThan(0.01);
  });
});

describe('archetype service', () => {
  /** Jev limps everything it plays (and folds nothing): its choice of how to play shows as limps. */
  const limpAll = () => fakeJev((names) => Object.fromEntries(names.map((n) => [n, n === 'call' ? 1 : 0])));
  const callIdx = rfi.actions.findIndex((a) => a.id === 'call');

  it('plays from the rules until the charts are built, and never calls JEV AI during play', () => {
    const jev = limpAll();
    const svc = new ArchetypeService(jev);
    expect(svc.frequencies('fish', rfi, 'AA')).toEqual(ruleFrequencies('fish', rfi, 'AA'));
    expect(jev.calls).toBe(0);
  });

  it('builds a node in 13 requests, blends the answers in, and skips hands it already has', async () => {
    const jev = limpAll();
    const svc = new ArchetypeService(jev);
    const rules = ruleFrequencies('fish', rfi, 'AA');
    expect(svc.build('fish', rfi)).toBe(13);
    await svc.idle();
    expect(jev.calls).toBe(13);
    expect(svc.frequencies('fish', rfi, 'AA')[callIdx]).toBeCloseTo(JEV_WEIGHT + (1 - JEV_WEIGHT) * rules[callIdx], 1);
    expect(svc.build('fish', rfi)).toBe(0);
  });

  it('keeps the rules for hands whose request failed, so building again fills them', async () => {
    let fail = true;
    const jev = {
      calls: 0,
      async choose(_s: Record<string, unknown>, questions: Record<string, unknown>) {
        jev.calls++;
        if (fail) throw new Error('down');
        return Object.fromEntries(Object.keys(questions).map((hc) => [hc, { fold: 1 }]));
      },
    };
    const svc = new ArchetypeService(jev);
    svc.build('nit', rfi);
    await svc.idle();
    expect(svc.frequencies('nit', rfi, 'AA')).toEqual(ruleFrequencies('nit', rfi, 'AA'));
    fail = false;
    expect(svc.build('nit', rfi)).toBe(13);
    await svc.idle();
    expect(svc.chartedNodes).toBe(1);
  });

  it('loads a charts file only when it was built for the same charts', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'jev-')), 'archetypes.json');
    const builder = new ArchetypeService(limpAll(), { chartsFile: file, chartsVersion: 'v1' });
    builder.build('lag', rfi);
    await builder.idle();
    builder.save();
    const offline = new ArchetypeService(null, { chartsFile: file, chartsVersion: 'v1' });
    expect(offline.chartedNodes).toBe(1);
    expect(offline.frequencies('lag', rfi, 'AA')[callIdx]).toBeGreaterThan(JEV_WEIGHT - 0.01);
    const otherCharts = new ArchetypeService(null, { chartsFile: file, chartsVersion: 'v2' });
    expect(otherCharts.frequencies('lag', rfi, 'AA')).toEqual(ruleFrequencies('lag', rfi, 'AA'));
  });

  it("plays the rules' width with JEV AI's choice of hands, however wide Jev answers", async () => {
    const W = ALL_HAND_CLASSES.reduce((s, hc) => s + combos(hc), 0);
    const width = (f: (hc: string) => number[]) => ALL_HAND_CLASSES.reduce((s, hc) => s + combos(hc) * (1 - f(hc)[foldIdx]), 0) / W;
    // Jev plays everything but 72o, and raises it all.
    const jev = fakeJev((names) => Object.fromEntries(names.map((n) => [n, n === 'raise' ? 0.99 : 0.01 / (names.length - 1)])));
    const svc = new ArchetypeService(jev);
    svc.build('nit', rfi);
    await svc.idle();
    expect(width((hc) => svc.frequencies('nit', rfi, hc))).toBeCloseTo(width((hc) => ruleFrequencies('nit', rfi, hc)), 3);
    // Hands Jev rates alike are ordered by the rules: aces stay in, weak offsuit hands go.
    expect(svc.frequencies('nit', rfi, 'AA')[foldIdx]).toBeLessThan(0.05);
    expect(svc.frequencies('nit', rfi, 'K4o')[foldIdx]).toBeGreaterThan(0.9);
    // Jev's choice of how to play is kept: raises, not limps.
    const aa = svc.frequencies('nit', rfi, 'AA');
    expect(aa[rfi.actions.findIndex((a) => a.id === 'raise')]).toBeGreaterThan(0.9);
  });

  it('reuses the base node for a "|nocall" node the charts derive, the call folded', async () => {
    const vsOpen = charts.getNode(makeNodeKey('SIX_MAX', 100, 'VS_OPEN', 'BB', 'BTN'));
    const noCall = charts.getNode(`${vsOpen.nodeKey}|nocall`);
    const svc = new ArchetypeService(fakeJev((names) => Object.fromEntries(names.map((n) => [n, n === 'call' ? 1 : 0]))));
    svc.build('fish', vsOpen);
    await svc.idle();
    expect(svc.frequencies('fish', noCall, 'KTo')).toEqual(ruleFrequencies('fish', noCall, 'KTo'));
    expect(svc.frequencies('fish', noCall, 'KTo', vsOpen)).not.toEqual(ruleFrequencies('fish', noCall, 'KTo'));
    expect(svc.frequencies('fish', noCall, 'KTo', vsOpen).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(svc.chartedNodes).toBe(1);
  });

  it("won't build without a key", () => {
    expect(() => new ArchetypeService(null).build('tag', rfi)).toThrow(/JEV_API_KEY/);
  });
});

describe('jev client', () => {
  const q = { AA: { instructions: 'What now?', criteria: { fold: 'Fold', raise: 'Raise' } } };

  it('retries when rate limited, and gives up with the status once out of time', async () => {
    let calls = 0;
    const answer = { answers: { AA: { probabilities: { fold: 0, raise: 1 } } } };
    const flaky = (async () => (++calls < 2 ? new Response('slow down', { status: 429 }) : new Response(JSON.stringify(answer)))) as unknown as typeof fetch;
    expect(await jevClient('k', undefined, undefined, flaky).choose({}, q)).toEqual({ AA: { fold: 0, raise: 1 } });
    expect(calls).toBe(2);
    const down = (async () => new Response('overloaded', { status: 529 })) as unknown as typeof fetch;
    await expect(jevClient('k', undefined, undefined, down).choose({}, q, 300)).rejects.toThrow(/529/);
  });

  it('sends choice questions to systemone and reads the probabilities back', async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify({ model: 'jev-1', answers: { AA: { type: 'choice', choice: 'raise', confidence: 0.9, probabilities: { fold: 0.1, raise: 0.9 } } }, usage: {} }));
    }) as unknown as typeof fetch;
    const out = await jevClient('key-1', 'jev-latest', 'https://jev.test/v1/systemone', fetchImpl).choose({ spot: 'CO open' }, { AA: { instructions: 'What now?', criteria: { fold: 'Fold', raise: 'Raise' } } });
    expect(out).toEqual({ AA: { fold: 0.1, raise: 0.9 } });
    expect(sent!.url).toBe('https://jev.test/v1/systemone');
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe('Bearer key-1');
    const body = JSON.parse(sent!.init.body as string);
    expect(body).toMatchObject({ model: 'jev-latest', state: { spot: 'CO open' }, questions: { AA: { type: 'choice', criteria: { fold: 'Fold', raise: 'Raise' } } } });
  });
});

describe('hand engine with archetypes', () => {
  const req = { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'BB', skipEasyFolds: false } as const;

  it('labels opponents with their archetype, and none for the charts', () => {
    const engine = new HandEngine(charts, seededRng(3), runoutResolver);
    const gto = engine.view(engine.start({ ...req, villainStyle: 'gto' }));
    expect(gto.seats.every((s) => s.archetype === undefined)).toBe(true);
    const fish = engine.view(engine.start({ ...req, villainStyle: 'fish' }));
    expect(fish.seats.filter((s) => !s.isHero).every((s) => s.archetype === 'fish')).toBe(true);
    expect(fish.seats.find((s) => s.isHero)!.archetype).toBeUndefined();
    const mixed = engine.view(engine.start({ ...req, villainStyle: 'mixed' }));
    expect(mixed.seats.filter((s) => !s.isHero).every((s) => s.archetype)).toBe(true);
  });

  it('has fish tables play more pots against the big blind than chart tables', () => {
    const potsEntered = (villainStyle: 'gto' | 'fish' | 'nit') => {
      const engine = new HandEngine(charts, seededRng(7), runoutResolver);
      let entered = 0;
      for (let i = 0; i < 400; i++) {
        const state = engine.start({ ...req, villainStyle });
        entered += state.actionLog.filter((a) => !a.isHero && a.street === 'preflop' && (a.action as ActionType) !== 'fold').length;
      }
      return entered;
    };
    const gto = potsEntered('gto');
    expect(potsEntered('fish')).toBeGreaterThan(gto * 1.3);
    expect(potsEntered('nit')).toBeLessThan(gto);
  });
});

describe('hand reading for JEV AI', () => {
  it('names made hands and draws', () => {
    expect(describeHand(['Ks', 'Qd'], ['Kh', '7d', '2c']).madeHand).toBe('top pair (kings), queen kicker');
    expect(describeHand(['As', 'Ad'], ['Kh', '7d', '2c']).madeHand).toBe('overpair (pocket aces)');
    expect(describeHand(['7s', '6s'], ['Kh', '7d', '2c']).madeHand).toBe('middle pair (sevens), 6 kicker');
    expect(describeHand(['Ah', 'Qh'], ['Kh', '7h', '2c'])).toEqual({ madeHand: 'no pair, ace high', draws: ['flush draw (both my cards)'] });
    expect(describeHand(['9s', '8d'], ['Th', '7d', '2c']).draws).toEqual(['open-ended straight draw']);
    expect(describeHand(['9s', '8d'], ['Qh', 'Td', '2c']).draws).toEqual(['gutshot straight draw (needs a jack)']);
    expect(describeHand(['2s', '3d'], ['Ah', 'Kh', 'Qh', 'Jh', 'Th']).madeHand).toMatch(/board plays/);
  });

  it('writes the betting so far, one line per street', () => {
    const log = [
      { position: 'UTG', action: 'fold', toBb: 0, isHero: false, street: 'preflop' },
      { position: 'BTN', action: 'raise', toBb: 2.5, isHero: true, street: 'preflop' },
      { position: 'BB', action: 'call', toBb: 2.5, isHero: false, street: 'preflop' },
      { position: 'BB', action: 'check', toBb: 2.5, isHero: false, street: 'flop', streetBb: 0 },
      { position: 'BTN', action: 'bet', toBb: 4.3, isHero: true, street: 'flop', streetBb: 1.8 },
    ] as ActionLogEntry[];
    expect(actionHistory(log, ['Kh', '7d', '2c'])).toEqual(['Preflop: BTN raises to 2.5, BB calls 2.5', 'Flop (Kh 7d 2c): BB checks, BTN bets 1.8']);
  });
});

describe('JEV AI after the flop', () => {
  const flops = new FlopStore(fakeSolverOutput());
  /** Preflop questions get an even answer; the postflop "action" question bets whenever it can. */
  const jev = fakeJev((names) => Object.fromEntries(names.map((n) => [n, n.startsWith('bet') ? 1 : names.includes('bet') ? 0 : 1 / names.length])));
  const req = { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'BTN', opponentPosition: 'BB', villainStyle: 'fish', skipEasyFolds: false } as const;

  /** A hand where hero opened the BTN and the fish in the BB called: on the flop, waiting for the BB. */
  function toFlop(engine: HandEngine) {
    for (let i = 0; i < 500; i++) {
      const state = engine.start(req);
      if (engine.pendingDecision(state)!.nodeKey !== 'SIX_MAX|100|RFI|BTN') continue;
      engine.decide(state, 'raise');
      if (engine.awaitingVillain(state)) return state;
    }
    throw new Error('no flop reached');
  }

  it('pauses for the opponent and plays the action JEV AI picks', () => {
    const engine = new HandEngine(charts, seededRng(5), runoutResolver, flops, false, new ArchetypeService(jev));
    const state = toFlop(engine);
    expect(engine.view(state).legalActions).toEqual([]);
    const q = engine.villainQuestion(state)!;
    expect(q.options.map(([name]) => name)).toEqual(['check', 'bet']);
    expect(q.state).toMatchObject({ street: 'flop', board: state.board.join(' '), opponent_position: 'BTN', pot_bb: 5.5, to_call_bb: 0 });
    expect(q.state.player).toMatch(/fish/);
    expect(q.state.action_so_far).toEqual(['Preflop: BTN raises to 2.5, BB calls 2.5']);
    engine.applyVillainChoice(state, [0, 1]);
    expect(state.actionLog.at(-1)).toMatchObject({ position: 'BB', action: 'bet', street: 'flop' });
    expect(engine.view(state).legalActions.map((a) => a.id)).toEqual(['fold', 'call', 'raise']);
  });

  it('plays the solver strategy when JEV AI has no answer', () => {
    const engine = new HandEngine(charts, seededRng(6), runoutResolver, flops, false, new ArchetypeService(jev));
    const state = toFlop(engine);
    engine.applyVillainChoice(state, null);
    // The fake solver always checks here.
    expect(state.actionLog.at(-1)).toMatchObject({ position: 'BB', action: 'check', street: 'flop', decidedBy: 'solver' });
    expect(state.heroToAct).toBe(true);
  });

  it('without a key, archetypes play the solver after the flop and never pause', () => {
    const engine = new HandEngine(charts, seededRng(5), runoutResolver, flops);
    for (let i = 0; i < 200; i++) {
      const state = engine.start(req);
      if (engine.pendingDecision(state)!.nodeKey !== 'SIX_MAX|100|RFI|BTN') continue;
      engine.decide(state, 'raise');
      expect(engine.awaitingVillain(state)).toBe(false);
    }
  });

  it('HandService asks JEV AI before answering the decision', async () => {
    const engine = new HandEngine(charts, seededRng(8), runoutResolver, flops, false, new ArchetypeService(jev));
    const service = new HandService(engine, new MemoryRepo());
    const guest = { kind: 'guest', guestId: '11111111-1111-4111-8111-111111111111' } as const;
    for (let i = 0; i < 500; i++) {
      const state = await service.start(guest, { ...req, sessionId: `s-${i}` });
      if (engine.pendingDecision(state)!.nodeKey !== 'SIX_MAX|100|RFI|BTN') continue;
      const { state: after } = await service.decide(guest, state.id, 'raise');
      if (!after.postflop) continue;
      expect(engine.awaitingVillain(after)).toBe(false);
      expect(after.actionLog.at(-1)).toMatchObject({ position: 'BB', action: 'bet', street: 'flop', decidedBy: 'jev' });
      expect(after.actionLog.at(-1)!.jevMs).toBeGreaterThanOrEqual(0);
      return;
    }
    throw new Error('no flop reached');
  });
});
