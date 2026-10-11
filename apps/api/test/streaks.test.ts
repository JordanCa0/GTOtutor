import { describe, expect, it } from 'vitest';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { MemoryRepo } from '../src/db/repo.js';
import { HandEngine, type HandState } from '../src/engine/handEngine.js';
import { HandService } from '../src/engine/handService.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { seededRng } from '../src/poker/rng.js';
import { computeSessionStats, isStreakMilestone, streakOf } from '../src/teacher/sessionStats.js';

const charts = new ChartService(buildFixtureChartSet());
const GUEST = { kind: 'guest' as const, guestId: '11111111-1111-4111-8111-111111111111' };
const req = { tableSize: 'SIX_MAX' as const, stackDepthBb: 100 as const, heroPosition: 'random' as const, skipEasyFolds: false, sessionId: 'streak-session-1' };

describe('streak rules', () => {
  it('adds on best, keeps on mixed, ends on a mistake', () => {
    const g = (s: string) => [...s].map((c) => ({ grade: ({ b: 'best', m: 'mixed', x: 'mistake' } as const)[c as 'b' | 'm' | 'x'] }));
    expect(streakOf(g('bbmb'))).toEqual({ current: 3, best: 3 });
    expect(streakOf(g('bbbxb'))).toEqual({ current: 1, best: 3 });
    expect(streakOf([])).toEqual({ current: 0, best: 0 });
    expect([4, 5, 10, 20, 25, 30, 50, 75].map(isStreakMilestone)).toEqual([false, true, true, true, true, false, true, true]);
  });
});

describe('streak per decision', () => {
  /** Plays hero's most frequent option (a best play) or least frequent one (usually a mistake). */
  async function play(hands: HandService, engine: HandEngine, state: HandState, pick: 'best' | 'worst') {
    const pending = engine.pendingDecision(state)!;
    const freqs = pending.options.map((o) => o.frequency);
    const i = freqs.indexOf(pick === 'best' ? Math.max(...freqs) : Math.min(...freqs));
    return hands.decide(GUEST, state.id, pending.actions[i].id, pending.actions[i].toBb ?? undefined);
  }

  it('counts up across hands, flags milestones and endings, and survives a restart', async () => {
    const repo = new MemoryRepo();
    const engine = new HandEngine(charts, seededRng(5), runoutResolver);
    const hands = new HandService(engine, repo);
    const counts: number[] = [];
    const milestones: number[] = [];
    while (counts.length < 6) {
      let state = await hands.start(GUEST, req);
      while (engine.view(state).status === 'awaiting_hero' && counts.length < 6) {
        const res = await play(hands, engine, state, 'best');
        expect(res.feedback.grade).toBe('best');
        counts.push(res.streak.count);
        if (res.streak.milestone) milestones.push(res.streak.milestone);
        state = res.state;
      }
    }
    expect(counts).toEqual([1, 2, 3, 4, 5, 6]);
    expect(milestones).toEqual([5]);
    expect(computeSessionStats(await hands.sessionHands(GUEST, req.sessionId), false).bestStreak).toBe(6);

    // A new server: the streak comes back from the saved decisions.
    const engine2 = new HandEngine(charts, seededRng(6), runoutResolver);
    const hands2 = new HandService(engine2, repo);
    let expected = 6;
    for (;;) {
      const state = await hands2.start(GUEST, req);
      const res = await play(hands2, engine2, state, 'worst');
      if (res.feedback.grade === 'best') {
        expect(res.streak.count).toBe(++expected);
        continue;
      }
      if (res.feedback.grade === 'mixed') continue;
      expect(res.streak).toMatchObject({ count: 0, best: res.streak.best, ended: expect.any(Number) });
      expect(res.streak.ended).toBe(expected);
      break;
    }
  });
});
