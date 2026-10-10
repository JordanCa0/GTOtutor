import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { MemoryRepo } from '../src/db/repo.js';
import { HandEngine } from '../src/engine/handEngine.js';
import { HandService } from '../src/engine/handService.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { CardMapper, parseCards } from '../src/postflop/flopMap.js';
import { FlopStore } from '../src/postflop/flopStore.js';
import { liveTree, mapBoardCard, parseRange, turnRequest, turnStart, type LiveOut, type LiveRequest } from '../src/postflop/liveSolve.js';
import { LiveSolver, memoryCache, type SolverResponse, type SolverTransport } from '../src/postflop/liveSolver.js';
import { seededRng } from '../src/poker/rng.js';
import { fakeSolverOutput } from './fakes.js';

const charts = new ChartService(buildFixtureChartSet());
const root = fakeSolverOutput();
const flops = new FlopStore(root);
const GUEST = { kind: 'guest' as const, guestId: '11111111-1111-4111-8111-111111111111' };

describe('turn solve requests', () => {
  const data = flops.load('btn_vs_bb_srp_100', 'Kh7d2c');
  const spot = flops.spotInfo('btn_vs_bb_srp_100')!;

  it('reads range strings', () => {
    const r = parseRange('22:0.5,AKs,A2o:0.25,KQ');
    expect([r.get('22'), r.get('AKs'), r.get('A2o'), r.get('KQs'), r.get('KQo'), r.get('33')]).toEqual([0.5, 1, 0.25, 1, 1, undefined]);
  });

  it('rebuilds the ranges, pot and stacks for lines that reach the turn', () => {
    // BB checks (always), BTN checks back (half of every hand).
    const cc = turnStart(data, spot, [0, 0])!;
    expect([cc.potBb, cc.stackBb]).toEqual([5.5, 97.5]);
    expect(cc.ranges[0][0]).toBe(1);
    expect(cc.ranges[1][0]).toBe(0.5);
    // Check, bet 1.8, call.
    const bc = turnStart(data, spot, [0, 1, 1])!;
    expect([bc.potBb, bc.stackBb]).toEqual([9.1, 95.7]);
    // Not over yet, or a fold.
    expect(turnStart(data, spot, [0, 1])).toBeNull();
    expect(turnStart(data, spot, [0, 1, 0])).toBeNull();
  });

  it('builds the request on the solved board, with the live tree', () => {
    const req = turnRequest(data, spot, 'btn_vs_bb_srp_100', [0, 0], '9s', '4c')!;
    expect(req.board).toEqual(['Kh', '7d', '2c', '9s']);
    expect(req.riverCards).toEqual(['4c']);
    expect(req.turn).toEqual(['33%,75%,125%', '3x']);
    expect(liveTree('sb_vs_bb_limp_100').turn[1]).toBe('');
    expect(req.hands[0].length).toBe(req.ranges[0].length);
  });

  it('keeps a later card off the solved board and off the mapped turn', () => {
    const mapper = new CardMapper(parseCards('Ks8s2d'), parseCards('Kh7h2c'));
    const turn = mapBoardCard(mapper, '9c', ['Kh', '7h', '2c']);
    // 9c and 8c's neighbour can land on one card: the river moves to a free rank of the same suit.
    const river = mapBoardCard(mapper, 'Tc', ['Kh', '7h', '2c', turn]);
    expect(river).not.toBe(turn);
    expect(river[1]).toBe(turn[1]);
  });
});

/** A stand-in solver service: OOP checks, IP checks back or bets; facing a bet, call. Same on the river. */
function fakeSolve(req: LiveRequest): LiveOut {
  const fill = (n: number, v: number) => new Array<number>(n).fill(v);
  const street = (pot: number) => {
    const n = req.hands.map((h) => h.length);
    const bet = Math.round(pot * 0.75 * 100) / 100;
    return [
      { history: [], player: 0 as const, actions: ['check', `bet ${bet}`], strategy: [fill(n[0], 1000), fill(n[0], 0)], ev_bb: [fill(n[0], 1), fill(n[0], 0.5)] },
      { history: [0], player: 1 as const, actions: ['check', `bet ${bet}`], strategy: [fill(n[1], 500), fill(n[1], 500)], ev_bb: [fill(n[1], 1), fill(n[1], 1)] },
      { history: [0, 1], player: 0 as const, actions: ['fold', 'call'], strategy: [fill(n[0], 0), fill(n[0], 1000)], ev_bb: [fill(n[0], 0), fill(n[0], 1)] },
      { history: [1], player: 1 as const, actions: ['fold', 'call'], strategy: [fill(n[1], 0), fill(n[1], 1000)] },
    ];
  };
  return {
    board: req.board,
    hands: req.hands,
    exploitabilityPctPot: 0.5,
    nodes: street(req.potBb),
    rivers: [[0, 0], [0, 1, 1]].flatMap((turnLine) => req.riverCards.map((card) => ({ turnLine, card, nodes: street(req.potBb) }))),
  };
}

function fakeService(opts: { fail?: boolean; delayMs?: number } = {}) {
  const calls: LiveRequest[] = [];
  const transport: SolverTransport = async (payload) => {
    const req = JSON.parse(payload) as LiveRequest;
    calls.push(req);
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    if (opts.fail) return { commit: 'abc123', error: 'boom' } satisfies SolverResponse;
    return { commit: 'abc123', seconds: 0.1, gz: gzipSync(JSON.stringify(fakeSolve(req))).toString('base64') };
  };
  return { calls, transport };
}

function setup(seed: number, solverOpts: ConstructorParameters<typeof LiveSolver>[2] = {}, service = fakeService()) {
  const engine = new HandEngine(charts, seededRng(seed), runoutResolver, flops, true);
  const solver = new LiveSolver(service.transport, memoryCache(), solverOpts);
  const hands = new HandService(engine, new MemoryRepo(), undefined, solver);
  return { engine, hands, service };
}

const flopPractice = { tableSize: 'SIX_MAX' as const, stackDepthBb: 100 as const, heroPosition: 'BTN' as const, flopPractice: true, sessionId: 'live-test-session-1' };

describe('live turn and river play', () => {
  it('waits for the turn solve, then plays the turn and river from it', async () => {
    const { engine, hands, service } = setup(31);
    let turns = 0;
    for (let i = 0; i < 6; i++) {
      let state = await hands.start(GUEST, flopPractice);
      // Hero (BTN) checks back the flop: the hand goes to the turn and waits for its solve.
      ({ state } = await hands.decide(GUEST, state.id, 'check'));
      expect(engine.view(state)).toMatchObject({ solving: 'turn', board: expect.any(Array) });
      expect(state.board).toHaveLength(4);
      await hands.settled(state.id);
      // The turn: BB checks (fake strategy), hero acts; then the river; then a showdown.
      while (engine.view(state).status === 'awaiting_hero') {
        const view = engine.view(state);
        expect(view.solving).toBeNull();
        const action = view.legalActions.find((a) => a.id === 'check' || a.id === 'call')!;
        const res = await hands.decide(GUEST, state.id, action.id, action.toBb ?? undefined);
        if (res.feedback.street === 'turn') turns++;
        expect(['turn', 'river']).toContain(res.feedback.street);
        expect(res.feedback.nodeKey).toMatch(/^LIVE\|[0-9a-f]{32}\|(turn|river)\|/);
        expect(res.feedback.options).toHaveLength(2);
        await hands.settled(state.id);
      }
      const done = engine.view(state);
      expect(done.result!.board).toHaveLength(5);
      expect(done.solverCommit).toBe('abc123');
      expect(done.liveNote).toBeNull();
      expect(done.actionLog.some((a) => a.street === 'river')).toBe(true);
    }
    expect(turns).toBe(6);
    // Each hand's turn solve was asked for once (speculatively, while hero decided on the flop) and then reused.
    expect(service.calls.length).toBeLessThanOrEqual(6 * 2);
  });

  it('solves the turn while hero decides on the flop, so it is ready when the turn comes', async () => {
    const { engine, hands, service } = setup(32);
    const state = await hands.start(GUEST, flopPractice);
    // Hero's options: check (reaches the turn) and bet (BB's pre-drawn reply decides; it always calls here).
    await new Promise((r) => setTimeout(r, 10));
    // One solve per option that reaches the turn, with the turn and river cards the deck will deal.
    const speculative = service.calls.length;
    expect(speculative).toBeGreaterThanOrEqual(1);
    expect(service.calls).toEqual(engine.speculativeSolves(state).map((j) => j.request));
    await hands.decide(GUEST, state.id, 'check');
    await hands.settled(state.id);
    expect(service.calls.length).toBe(speculative);
    expect(engine.view(state).solving).toBeNull();
  });

  it('runs the hand out and says why when the solve fails or is too slow', async () => {
    for (const service of [fakeService({ fail: true }), fakeService({ delayMs: 200 })]) {
      const { engine, hands } = setup(33, { timeoutMs: 50 }, service);
      let state = await hands.start(GUEST, flopPractice);
      ({ state } = await hands.decide(GUEST, state.id, 'check'));
      await hands.settled(state.id);
      const view = engine.view(state);
      expect(view.status).toBe('complete');
      expect(view.result!.board).toHaveLength(5);
      expect(view.liveNote).toMatch(/run out/);
    }
  });

  it('stops solving for a player over the hourly limit', async () => {
    // One solve an hour: the speculative check line takes it, so the bet line can't be solved.
    const { engine, hands, service } = setup(34, { perPlayerPerHour: 1 });
    let state = await hands.start(GUEST, flopPractice);
    await new Promise((r) => setTimeout(r, 10));
    expect(service.calls).toHaveLength(1);
    ({ state } = await hands.decide(GUEST, state.id, 'bet'));
    await hands.settled(state.id);
    expect(engine.view(state).liveNote).toMatch(/busy/);
    expect(engine.view(state).status).toBe('complete');
  });

  it('carries on after a restart: the stored hand asks for the same solve again', async () => {
    const { engine, hands } = setup(35);
    let state = await hands.start(GUEST, flopPractice);
    ({ state } = await hands.decide(GUEST, state.id, 'check'));
    const request = engine.pendingSolve(state)!.request;
    await hands.settled(state.id);
    expect(engine.view(state).pendingSpot!.street).toBe('turn');
    // A new server: the hand comes back from storage without its solve, and waits for it again.
    const engine2 = new HandEngine(charts, seededRng(36), runoutResolver, flops, true);
    const again = engine2.restore(engine.serialize(state));
    expect(engine2.view(again).solving).toBe('turn');
    // Same request, so the same cache entry.
    expect(engine2.pendingSolve(again)!.request).toEqual(request);
    engine2.attachLiveSolve(again, { id: 'f'.repeat(32), commit: 'abc123', out: fakeSolve(request) });
    expect(engine2.view(again).pendingSpot!.street).toBe('turn');
    expect(engine2.view(again).legalActions.map((a) => a.id)).toEqual(engine.view(state).legalActions.map((a) => a.id));
  });

  it('keeps hands running out after the flop when live solving is off', () => {
    const engine = new HandEngine(charts, seededRng(37), runoutResolver, flops);
    const state = engine.start(flopPractice);
    engine.decide(state, 'check');
    expect(engine.view(state)).toMatchObject({ status: 'complete', solving: null });
  });
});
