import type { ActionType, DecisionFeedback, Grade } from '@gtotutor/shared-types';
import { describe, expect, it } from 'vitest';
import { gtoSummaryOf, styleOf } from '../src/teacher/playerStyle.js';

let n = 0;
/** A decision at a node offering these actions at these chart frequencies (and optional EVs). */
function decision(chosen: ActionType, freqs: Partial<Record<ActionType, number>>, opts: { grade?: Grade; ev?: Partial<Record<ActionType, number>>; nodeKey?: string } = {}): DecisionFeedback {
  const options = Object.entries(freqs).map(([id, f]) => ({ actionId: id as ActionType, label: id, frequency: f!, evBb: opts.ev?.[id as ActionType] ?? null }));
  const best = options.reduce((a, b) => (b.frequency > a.frequency ? b : a)).actionId;
  return {
    id: `d${n++}`,
    nodeKey: opts.nodeKey ?? 'SIX_MAX|100|VS_OPEN|BB|BTN',
    nodeLabel: 'BB facing BTN open',
    heroCards: ['As', 'Kd'],
    handClass: 'AKo',
    chosenAction: chosen,
    options,
    chosenFrequency: freqs[chosen] ?? 0,
    bestAction: best,
    grade: opts.grade ?? (chosen === best ? 'best' : 'mistake'),
    hintUsed: false,
    street: 'preflop',
    board: [],
    approxFlop: null,
  };
}

describe('style chart', () => {
  it('puts the chart’s own pure choices at the centre', () => {
    const ds = [decision('fold', { fold: 1, call: 0, raise: 0 }), decision('raise', { fold: 0, call: 0, raise: 1 }), decision('call', { fold: 0, call: 1, raise: 0 })];
    const { overall } = styleOf(ds);
    expect(overall.x.value).toBe(0);
    expect(overall.y.value).toBe(0);
    expect(overall.x.n).toBe(3);
  });

  it('reads always folding as tight and always raising as aggressive', () => {
    const spot = { fold: 0.5, call: 0.3, raise: 0.2 };
    const folder = styleOf([decision('fold', spot), decision('fold', spot)]).overall;
    expect(folder.x.value).toBe(-50); // continues 0% where the chart continues 50%
    expect(folder.y.value).toBe(-20); // raises 0% where the chart raises 20%
    const raiser = styleOf([decision('raise', spot), decision('raise', spot)]).overall;
    expect(raiser.x.value).toBe(50);
    expect(raiser.y.value).toBe(80);
  });

  it('averages a mixed spot to the centre when the player mixes like the chart', () => {
    const spot = { fold: 0.5, raise: 0.5 };
    const { overall } = styleOf([decision('fold', spot, { grade: 'mixed' }), decision('raise', spot, { grade: 'mixed' })]);
    expect(overall.x.value).toBe(0);
    expect(overall.y.value).toBe(0);
    expect(overall.x.se).toBeGreaterThan(0);
  });

  it('skips the loose axis where folding isn’t possible, and groups by spot', () => {
    const flop = decision('check', { check: 0.6, bet: 0.4 }, { nodeKey: 'FLOP|btn_vs_bb_srp_100|Kh7d2c|' });
    const style = styleOf([flop]);
    expect(style.overall.x.n).toBe(0);
    expect(style.overall.y.value).toBe(-40);
    expect(style.bySpot.map((s) => s.spot)).toEqual(['FLOP']);
  });
});

describe('GTO summary', () => {
  it('counts best and mixed as accurate, and averages EV lost where EVs exist', () => {
    const ds = [
      decision('call', { fold: 0.2, call: 0.8 }, { ev: { fold: 0, call: 1.5 } }), // best: loses 0
      decision('fold', { fold: 0.2, call: 0.8 }, { ev: { fold: 0, call: 1 } }), // mistake: loses 1bb
      decision('raise', { fold: 0.5, raise: 0.5 }, { grade: 'mixed' }), // no EVs: not counted
    ];
    expect(gtoSummaryOf(ds)).toEqual({ accuracy: 0.667, evLossBb: 0.5, evDecisions: 2 });
    expect(gtoSummaryOf([])).toEqual({ accuracy: 0, evLossBb: null, evDecisions: 0 });
  });
});
