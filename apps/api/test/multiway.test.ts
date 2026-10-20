import type { ActionType } from '@gtotutor/shared-types';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ArchetypeService } from '../src/archetypes/archetypeService.js';
import type { JevClient } from '../src/archetypes/jevClient.js';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { loadSolvedCharts } from '../src/charts/solvedCharts.js';
import { MemoryRepo } from '../src/db/repo.js';
import { HandEngine, sidePots, type HandState } from '../src/engine/handEngine.js';
import { HandService } from '../src/engine/handService.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { seededRng } from '../src/poker/rng.js';
import { chartActions } from './fakes.js';

const charts = new ChartService(buildFixtureChartSet());
const req = { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'random', skipEasyFolds: false } as const;

/** Plays random chart actions until hero is offered the multiway call; returns that hand. */
function toMultiwayCall(engine: HandEngine, request: Parameters<HandEngine['start']>[0] = req, seed = 5, accept: (state: HandState) => boolean = () => true): HandState {
  const rng = seededRng(seed);
  for (let i = 0; i < 20_000; i++) {
    const state = engine.start(request);
    let view = engine.view(state);
    while (view.status === 'awaiting_hero' && !view.multiwayCall) {
      const legal = chartActions(view);
      const pick = legal[rng.int(legal.length)];
      engine.decide(state, pick.id as ActionType, pick.toBb ?? undefined);
      view = engine.view(state);
    }
    if (view.multiwayCall && accept(state)) return state;
  }
  throw new Error('never offered a multiway call');
}

/** Hero checks or calls to the end, ungraded. */
function playPassively(engine: HandEngine, state: HandState): void {
  for (let i = 0; i < 40 && !state.result; i++) {
    const view = engine.view(state);
    const pick = view.legalActions.find((a) => a.id === 'check' || a.id === 'call') ?? view.legalActions[0];
    engine.act(state, pick.id as ActionType, pick.toBb ?? undefined);
  }
}

describe('multiway pots', () => {
  it('splits the pot into a main pot and side pots by stake, folded chips included', () => {
    const players = [
      { position: 'UTG', committed: 20 },
      { position: 'CO', committed: 60 },
      { position: 'BTN', committed: 100 },
      { position: 'BB', committed: 10 },
    ] as const;
    expect(sidePots([...players], players.slice(0, 3) as never)).toEqual([
      { amount: 70, eligible: ['UTG', 'CO', 'BTN'] },
      { amount: 80, eligible: ['CO', 'BTN'] },
      { amount: 40, eligible: ['BTN'] },
    ]);
  });

  it('offers a call where the charts keep pots heads-up, and plays it and the rest of the hand ungraded', () => {
    const engine = new HandEngine(charts, seededRng(3), runoutResolver);
    let threeWayShowdowns = 0;
    let freePlayed = 0;
    for (let seed = 0; seed < 60; seed++) {
      const state = toMultiwayCall(engine, req, seed);
      const graded = state.decisions.length;
      const view = engine.view(state);
      expect(view.pendingSpot!.nodeKey).toMatch(/\|nocall$/);
      expect(view.legalActions.filter((a) => a.id === 'call')).toHaveLength(1);
      expect(engine.ungraded(state, 'call')).toBe(true);
      expect(() => engine.decide(state, 'call')).toThrow(/Illegal action/);

      engine.act(state, 'call');
      expect(state.multiway).toBe(true);
      expect(state.actionLog.filter((a) => a.isHero).at(-1)).toMatchObject({ action: 'call', street: 'preflop' });
      const after = engine.view(state);
      expect(after).toMatchObject({ multiway: true, liveNote: expect.stringMatching(/multiway/) });
      if (after.status === 'awaiting_hero') {
        expect(after.pendingSpot).toBeNull();
        expect(() => engine.decide(state, after.legalActions[0].id as ActionType, after.legalActions[0].toBb ?? undefined)).toThrow(/not graded/);
      }
      if (state.free && state.free.seats.length > 2) freePlayed++;

      playPassively(engine, state);
      const r = state.result!;
      expect(state.decisions).toHaveLength(graded);
      expect(r.potBb).toBeCloseTo(state.players.reduce((s, p) => s + p.committed, 0), 5);
      // Every chip in the pot goes to someone.
      expect(Object.values(r.won ?? {}).reduce((s, x) => s + x!, 0)).toBeCloseTo(r.potBb, 1);
      if ((r.showdown?.length ?? 0) >= 3) threeWayShowdowns++;
    }
    expect(freePlayed).toBeGreaterThan(0);
    expect(threeWayShowdowns).toBeGreaterThan(0);
  });

  it('has JEV AI play chart bots after the flop in a multiway pot, told how many players are in', () => {
    const jev: JevClient = {
      async choose(_state, questions) {
        return Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, Object.fromEntries(Object.keys(q.criteria).map((n) => [n, n === 'check' || n === 'call' ? 1 : 0]))]));
      },
    };
    const engine = new HandEngine(charts, seededRng(4), runoutResolver, null, false, new ArchetypeService(jev));
    for (let seed = 0; seed < 200; seed++) {
      const state = toMultiwayCall(engine, req, seed);
      engine.act(state, 'call');
      const question = engine.villainQuestion(state);
      if (!question || state.free!.seats.length < 3) continue;
      expect(question.state.game).toMatch(/3-way after the flop/);
      expect(question.state.player).toMatch(/tight-aggressive|TAG/i);
      engine.applyVillainChoice(state, question.options.map(([name]) => (name === 'check' ? 1 : 0)), 3);
      expect(state.actionLog.filter((a) => !a.isHero && a.street === 'flop').at(-1)).toMatchObject({ decidedBy: 'jev', jevMs: 3 });
      return;
    }
    throw new Error('no three-way flop reached');
  });

  it('answers the multiway call with no feedback and no streak change', async () => {
    const engine = new HandEngine(charts, seededRng(6), runoutResolver);
    const service = new HandService(engine, new MemoryRepo());
    const guest = { kind: 'guest', guestId: '22222222-2222-4222-8222-222222222222' } as const;
    for (let i = 0; i < 5000; i++) {
      const state = await service.start(guest, { ...req, sessionId: `mw-${i}` });
      if (!engine.view(state).multiwayCall) continue;
      const out = await service.submit(guest, state.id, 'call');
      expect(out).toMatchObject({ feedback: null, streak: null });
      expect(out.state.multiway).toBe(true);
      return;
    }
    throw new Error('never offered a multiway call');
  });

  it('20bb: hero can call two all-ins, and the three-way pot goes to showdown', () => {
    const manifest = fileURLToPath(new URL('../../../preflop/charts/stacks-v1.json', import.meta.url));
    const stacks = new ChartService(loadSolvedCharts(manifest, { lazyMixed: true }), 4);
    const engine = new HandEngine(stacks, seededRng(8), runoutResolver);
    const twoJams = (s: HandState) => s.players.filter((p) => !p.isHero && p.allIn).length === 2;
    const state = toMultiwayCall(engine, { ...req, stackDepthBb: 20 }, 9, twoJams);
    expect(engine.view(state).legalActions.find((a) => a.id === 'call')!.label).toBe('Call all-in 20');
    engine.act(state, 'call');
    const r = state.result!;
    expect(r.showdown).toHaveLength(3);
    expect(r.board).toHaveLength(5);
    expect(r.potBb).toBeGreaterThanOrEqual(60);
    expect(Object.values(r.won!).reduce((s, x) => s + x!, 0)).toBeCloseTo(r.potBb, 1);
  }, 60_000);
});
