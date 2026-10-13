import type { ActionType, MixedStacks, StackDepth } from '@gtotutor/shared-types';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { loadSolvedCharts } from '../src/charts/solvedCharts.js';
import { tierDepth } from '../src/charts/stackProfile.js';
import { HandEngine } from '../src/engine/handEngine.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import type { FlopStore } from '../src/postflop/flopStore.js';
import { seededRng } from '../src/poker/rng.js';

// The stacks-v1 manifest: 100bb is preflop-v9, plus 20bb, 60bb, 18 tables with one short seat and 60
// with several. Mixed profiles load on demand as on the server (eviction has its own test below).
const manifest = fileURLToPath(new URL('../../../preflop/charts/stacks-v1.json', import.meta.url));
const charts = new ChartService(loadSolvedCharts(manifest, { lazyMixed: true }), 100);
const base = { tableSize: 'SIX_MAX', heroPosition: 'random' } as const;
/** Timeout for the tests that play hundreds of hands. */
const LONG = 60_000;

/** A flop store with no flops that records which spots the engine asks for. */
function spyFlops(asked: string[]): FlopStore {
  return { solvedFlops: (spot: string) => (asked.push(spot), []) } as unknown as FlopStore;
}

/** Plays `n` hands with random hero actions, checking each one's accounting and chart lookups. */
function playMany(req: { stackDepthBb: StackDepth | 'random'; mixedStacks?: MixedStacks; simplePots?: boolean }, n: number, seed: number) {
  const asked: string[] = [];
  const engine = new HandEngine(charts, seededRng(seed), runoutResolver, spyFlops(asked));
  const rng = seededRng(seed + 1);
  const profiles = new Set<string>();
  let showdowns = 0;
  let sidePots = 0;
  for (let i = 0; i < n; i++) {
    asked.length = 0;
    const state = engine.start({ ...base, ...req });
    const profile = state.config.profile!;
    profiles.add(profile);
    let view = engine.view(state);
    while (view.status === 'awaiting_hero') {
      // Every decision is a solved node of this hand's profile, never a placeholder.
      expect(view.pendingSpot!.nodeKey.startsWith(`SIX_MAX|${profile}|`)).toBe(true);
      const legal = view.legalActions;
      engine.decide(state, legal[rng.int(legal.length)].id as ActionType, undefined);
      view = engine.view(state);
    }
    const r = view.result!;
    const stacks = state.config.stacks!;
    for (const seat of view.seats) {
      expect(seat.committedBb).toBeLessThanOrEqual(stacks[seat.position] + 1e-9);
      expect(seat.stackBb).toBeGreaterThanOrEqual(-1e-9);
    }
    expect(r.potBb).toBeCloseTo(view.seats.reduce((s, x) => s + x.committedBb, 0), 5);
    const hero = view.seats.find((s) => s.isHero)!;
    expect(r.heroNetBb).toBeGreaterThanOrEqual(-hero.committedBb - 1e-9);
    if (r.showdown) {
      showdowns++;
      // A short stack all in wins at most its own stake from each player; the rest is a side pot.
      const live = view.seats.filter((s) => !s.folded);
      const stake = Math.min(...live.map((s) => s.committedBb));
      if (live.some((s) => s.committedBb > stake)) {
        sidePots++;
        expect(r.summary).toMatch(/side pot/);
        const winnable = view.seats.reduce((s, x) => s + Math.min(x.committedBb, stake), 0);
        if (!hero.folded && hero.committedBb === stake) expect(r.heroNetBb).toBeLessThanOrEqual(winnable - stake + 1e-9);
      }
    }
    // A heads-up pot looks for the flops of its effective stack's depth.
    for (const spot of asked) {
      const depth = Number(spot.split('_').at(-1));
      expect([...new Set(Object.values(stacks).map(tierDepth))]).toContain(depth);
    }
  }
  return { profiles, showdowns, sidePots };
}

describe('stack depths (stacks-v1 charts)', () => {
  it('offers 20, 60 and 100bb, one short seat on 60 and 100, several on 100', () => {
    expect(charts.tableOptions()).toEqual({ stackDepths: [20, 60, 100], mixedStacks: { one: [60, 100], several: [100] } });
    expect(new ChartService(buildFixtureChartSet()).tableOptions()).toEqual({ stackDepths: [100], mixedStacks: { one: [], several: [] } });
  });

  it('keeps mixed profiles on disk until a hand needs them, and only the recent ones in memory', () => {
    const lazy = new ChartService(loadSolvedCharts(manifest, { lazyMixed: true }), 2);
    expect(lazy.loadedProfiles).toEqual([]);
    expect(lazy.profiles).toHaveLength(81);
    expect(lazy.getNode('SIX_MAX|100:BB20|RFI|UTG').actions.length).toBeGreaterThan(1);
    lazy.getNode('SIX_MAX|100:UTG20:HJ60:CO60|RFI|UTG');
    lazy.getNode('SIX_MAX|60:SB20|RFI|UTG');
    expect(lazy.loadedProfiles).toEqual(['100:UTG20:HJ60:CO60', '60:SB20']);
    // Equal stacks are always loaded.
    lazy.getNode('SIX_MAX|20|RFI|UTG');
    expect(lazy.loadedProfiles).toHaveLength(2);
  });

  it("names each equal-stack profile by its own chart file, so 100bb shares preflop-v9's archetype charts", () => {
    expect(charts.version).toBe('stacks-v1');
    expect(charts.profileVersion('100')).toBe('preflop-v9');
    expect(charts.profileVersion('20')).toBe('stacks-v1-20');
    expect(new ChartService(buildFixtureChartSet()).profileVersion('100')).toBe(buildFixtureChartSet().version);
  });

  it('refuses depths the charts lack', () => {
    const engine = new HandEngine(charts, seededRng(1), runoutResolver);
    expect(() => engine.start({ ...base, stackDepthBb: 40 })).toThrow(/not available/);
    expect(() => engine.start({ ...base, stackDepthBb: 20, mixedStacks: 'one' })).toThrow(/not available/);
    expect(() => engine.start({ ...base, stackDepthBb: 60, mixedStacks: 'several' })).toThrow(/not available/);
    const placeholder = new HandEngine(new ChartService(buildFixtureChartSet()), seededRng(1), runoutResolver);
    expect(() => placeholder.start({ ...base, stackDepthBb: 20 })).toThrow(/not available/);
  });

  for (const stackDepthBb of [20, 60] as const) {
    for (const simplePots of [false, true]) {
      it(`plays ${stackDepthBb}bb hands to the end${simplePots ? ' with simple pots' : ''}`, () => {
        const { profiles, showdowns } = playMany({ stackDepthBb, simplePots }, 600, stackDepthBb + (simplePots ? 1 : 0));
        expect([...profiles]).toEqual([String(stackDepthBb)]);
        expect(showdowns).toBeGreaterThan(0);
      }, LONG);
    }
  }

  for (const stackDepthBb of [60, 100] as const) {
    it(`deals solved tables with one short seat at ${stackDepthBb}bb`, () => {
      const { profiles } = playMany({ stackDepthBb, mixedStacks: 'one' }, 800, stackDepthBb * 3);
      // Every profile dealt is a solved one with one shorter seat; most of them come up.
      for (const p of profiles) expect(p).toMatch(new RegExp(`^${stackDepthBb}:(UTG|HJ|CO|BTN|SB|BB)(20|60)$`));
      expect(profiles.size).toBeGreaterThan(stackDepthBb === 100 ? 9 : 4);
    }, LONG);
  }

  it('deals solved tables with several short seats at 100bb: one 20bb and two 60bb', () => {
    const { profiles, sidePots } = playMany({ stackDepthBb: 100, mixedStacks: 'several' }, 1200, 700);
    // Some hands end with a short stack all in behind a bigger pot (see `finish`).
    expect(sidePots).toBeGreaterThan(0);
    for (const p of profiles) {
      const stacks = p.split(':').slice(1).map((e) => e.replace(/^[A-Z]+/, ''));
      expect(stacks.sort()).toEqual(['20', '60', '60']);
    }
    expect(profiles.size).toBeGreaterThan(40);
  }, LONG);

  it('Random deals a new depth each hand, among those with charts for the chosen stacks', () => {
    const equal = playMany({ stackDepthBb: 'random' }, 300, 31).profiles;
    expect([...equal].sort()).toEqual(['100', '20', '60']);
    const one = playMany({ stackDepthBb: 'random', mixedStacks: 'one' }, 300, 32).profiles;
    expect(new Set([...one].map((p) => p.split(':')[0]))).toEqual(new Set(['60', '100']));
    const engine = new HandEngine(charts, seededRng(33), runoutResolver);
    for (let i = 0; i < 30; i++) expect(engine.start({ ...base, stackDepthBb: 'random' }).config.stackDepthBb).toBeOneOf([20, 60, 100]);
    expect(() => engine.start({ ...base, stackDepthBb: 'random', flopPractice: true })).toThrow(/100bb only/);
  }, LONG);

  it('20bb is open, shove or fold, and a shove is answered by fold or call', () => {
    const engine = new HandEngine(charts, seededRng(5), runoutResolver);
    const first = engine.view(engine.start({ ...base, stackDepthBb: 20, heroPosition: 'UTG', skipEasyFolds: false }));
    expect(first.legalActions.map((a) => [a.id, a.toBb])).toEqual([
      ['fold', null],
      ['raise', 2],
      ['allin', 20],
    ]);
    // Facing an all-in: its own chart node, fold or call it off.
    let found = false;
    for (let i = 0; i < 400 && !found; i++) {
      const view = engine.view(engine.start({ ...base, stackDepthBb: 20, heroPosition: 'BB', skipEasyFolds: false }));
      if (!view.pendingSpot?.nodeKey.includes('|VS_ALLIN|')) continue;
      found = true;
      expect(view.legalActions.map((a) => [a.id, a.label])).toEqual([
        ['fold', 'Fold'],
        ['call', 'Call all-in 20'],
      ]);
    }
    expect(found).toBe(true);
  });
});
