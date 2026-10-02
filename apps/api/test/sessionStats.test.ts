import type { ActionType, DecisionFeedback, Grade } from '@gtotutor/shared-types';
import { describe, expect, it } from 'vitest';
import { computeSessionStats, leakTypeOf, spotTypeOf } from '../src/teacher/sessionStats.js';

function decision(nodeKey: string, chosen: ActionType, freqs: Partial<Record<ActionType, number>>, grade: Grade): DecisionFeedback {
  const options = (Object.entries(freqs) as [ActionType, number][]).map(([actionId, frequency]) => ({ actionId, label: actionId, frequency, evBb: null }));
  const best = options.reduce((a, b) => (b.frequency > a.frequency ? b : a));
  return {
    id: Math.random().toString(),
    nodeKey,
    nodeLabel: nodeKey,
    heroCards: ['Ah', 'Kd'],
    handClass: 'AKo',
    chosenAction: chosen,
    options,
    chosenFrequency: freqs[chosen] ?? 0,
    bestAction: best.actionId,
    grade,
    hintUsed: false,
    street: 'preflop',
    board: [],
    approxFlop: null,
  };
}

describe('session stats', () => {
  it('maps node keys to spot types', () => {
    expect(spotTypeOf('SIX_MAX|100|RFI|UTG')).toBe('RFI');
    expect(spotTypeOf('SIX_MAX|100|VS_OPEN|BB|BTN')).toBe('VS_OPEN');
    expect(spotTypeOf('SIX_MAX|100|COLD_VS_3BET|HJ')).toBe('VS_3BET');
    expect(spotTypeOf('SIX_MAX|100|VS_5BET|UTG|BB')).toBe('VS_4BET_PLUS');
  });

  it('classifies mistakes into leak types', () => {
    const key = 'SIX_MAX|100|VS_OPEN|BB|BTN';
    expect(leakTypeOf(decision(key, 'fold', { fold: 0, call: 1, raise: 0 }, 'mistake'))).toBe('over_fold');
    expect(leakTypeOf(decision(key, 'call', { fold: 1, call: 0, raise: 0 }, 'mistake'))).toBe('over_call');
    expect(leakTypeOf(decision(key, 'call', { fold: 0, call: 0.05, raise: 0.95 }, 'mistake'))).toBe('under_raise');
    expect(leakTypeOf(decision(key, 'raise', { fold: 0, call: 1, raise: 0 }, 'mistake'))).toBe('over_raise');
    expect(leakTypeOf(decision(key, 'call', { fold: 0.4, call: 0.6, raise: 0 }, 'best'))).toBeNull();
    expect(leakTypeOf(decision('SIX_MAX|100|VS_LIMP|BB|SB', 'check', { check: 0, raise: 1 }, 'mistake'))).toBe('under_raise');
    expect(spotTypeOf('SIX_MAX|100|VS_ISO|SB|BB')).toBe('LIMPED');
  });

  it('aggregates grades, spots, leaks, and the worst mistakes', () => {
    const hands = [
      { decisions: [decision('SIX_MAX|100|RFI|UTG', 'raise', { fold: 0, raise: 1 }, 'best')] },
      { decisions: [decision('SIX_MAX|100|VS_OPEN|BB|UTG', 'call', { fold: 1, call: 0, raise: 0 }, 'mistake'), decision('SIX_MAX|100|VS_3BET|UTG|BB', 'call', { fold: 0.3, call: 0.7, raise: 0 }, 'best')] },
      { decisions: [decision('SIX_MAX|100|VS_OPEN|BB|CO', 'call', { fold: 0.92, call: 0.08, raise: 0 }, 'mistake')] },
      { decisions: [] },
    ];
    const stats = computeSessionStats(hands, true);
    expect(stats).toMatchObject({ hands: 3, decisions: 4, grades: { best: 2, mixed: 0, mistake: 2 }, easyFoldsSkipped: true });
    expect(stats.bySpot.map((s) => s.spot)).toEqual(['RFI', 'VS_OPEN', 'VS_3BET']);
    expect(stats.leaks).toEqual([{ type: 'over_call', label: expect.any(String), count: 2 }]);
    expect(stats.worstMistakes.map((m) => m.chosenFrequency)).toEqual([0, 0.08]);
  });
});
