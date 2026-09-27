import type { DecisionFeedback } from '@gtotutor/shared-types';
import { describe, expect, it, vi } from 'vitest';
import { findUngroundedPercentages } from '../src/teacher/grounding.js';
import { ExplanationUnavailable, LlmTeacher, buildContext, type ExplainInput } from '../src/teacher/llmTeacher.js';
import { HourlyRateLimiter } from '../src/teacher/rateLimit.js';

const decision: DecisionFeedback = {
  id: 'h-d1',
  nodeKey: 'SIX_MAX|100|VS_OPEN|BTN|CO',
  nodeLabel: 'BTN facing CO open',
  heroCards: ['Ah', '5h'],
  handClass: 'A5s',
  chosenAction: 'raise',
  options: [
    { actionId: 'fold', label: 'Fold', frequency: 0.4, evBb: null },
    { actionId: 'call', label: 'Call 2.5', frequency: 0, evBb: null },
    { actionId: 'raise', label: '3-bet to 7.5', frequency: 0.6, evBb: null },
  ],
  chosenFrequency: 0.6,
  bestAction: 'raise',
  grade: 'best',
};

const input: ExplainInput = {
  decision,
  actionsBefore: [
    { position: 'UTG', action: 'fold', toBb: 0, isHero: false },
    { position: 'CO', action: 'raise', toBb: 2.5, isHero: false },
  ],
  heroPosition: 'BTN',
  stackDepthBb: 100,
  rangeSummary: [
    { label: 'Fold', share: 0.8 },
    { label: 'Call', share: 0.12 },
    { label: '3-bet to 7.5', share: 0.08 },
  ],
  dataSource: { kind: 'fixture', note: 'Placeholder ranges.' },
};

describe('grounding check', () => {
  it('accepts supplied numbers within tolerance and flags invented ones', () => {
    expect(findUngroundedPercentages('3-bets 60% and folds 40%, roughly 59.5 %', [60, 40])).toEqual([]);
    expect(findUngroundedPercentages('wins 73% of the time', [60, 40])).toEqual(['73%']);
  });
});

describe('rate limiter', () => {
  it('allows `limit` hits per hour per key', () => {
    let now = 0;
    const rl = new HourlyRateLimiter(2, () => now);
    expect(rl.tryConsume('a')).toBe(true);
    expect(rl.tryConsume('a')).toBe(true);
    expect(rl.tryConsume('a')).toBe(false);
    expect(rl.tryConsume('b')).toBe(true);
    now = 60 * 60 * 1000 + 1;
    expect(rl.tryConsume('a')).toBe(true);
  });
});

describe('LlmTeacher', () => {
  it('puts the chart numbers and prior action in the context', () => {
    const ctx = buildContext(input);
    expect(ctx).toContain('Ah 5h (class A5s)');
    expect(ctx).toContain('3-bet to 7.5 60%');
    expect(ctx).toContain('CO raises to 2.5');
    expect(ctx).toContain('EV: not available');
  });

  it('caches grounded explanations and does not re-charge the rate limit on hits', async () => {
    const generate = vi.fn().mockResolvedValue({ explanationText: 'The chart 3-bets A5s 60% of the time.', keyFactors: ['Ace blocker'] });
    const teacher = new LlmTeacher(generate, 'test', 1);
    const first = await teacher.explain(input, 'ip');
    const second = await teacher.explain(input, 'ip');
    expect(first).toMatchObject({ status: 'ok', cached: false, ungroundedNumbers: [] });
    expect(second).toMatchObject({ status: 'ok', cached: true });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('flags and does not cache explanations with invented numbers', async () => {
    const generate = vi.fn().mockResolvedValue({ explanationText: 'A5s has 73% equity here.', keyFactors: [] });
    const teacher = new LlmTeacher(generate, 'test', 10);
    expect(await teacher.explain(input, 'ip')).toMatchObject({ status: 'ok', ungroundedNumbers: ['73%'] });
    await teacher.explain(input, 'ip');
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('rate-limits cache misses per client', async () => {
    const generate = vi.fn().mockResolvedValue({ explanationText: 'ok', keyFactors: [] });
    const teacher = new LlmTeacher(generate, 'test', 1);
    await teacher.explain(input, 'ip');
    const other = { ...input, decision: { ...decision, handClass: 'A4s' } };
    expect(await teacher.explain(other, 'ip')).toMatchObject({ status: 'unavailable' });
  });

  it('reports generator failures as unavailable instead of throwing', async () => {
    const teacher = new LlmTeacher(() => Promise.reject(new ExplanationUnavailable('no key')), 'test', 10);
    expect(await teacher.explain(input, 'ip')).toEqual({ status: 'unavailable', reason: 'no key' });
  });
});
