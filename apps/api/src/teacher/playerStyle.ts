import type { ActionType, DecisionFeedback, GtoSummary, PlayerStyle, SpotType, StyleAxis, StylePoint } from '@gtotutor/shared-types';
import { spotLabel, spotTypeOf } from './sessionStats.js';

const AGGRESSIVE = new Set<ActionType>(['bet', 'raise', 'allin']);

/** Mean of the samples in percentage points, with the standard error of that mean. */
function axisOf(samples: number[]): StyleAxis {
  const n = samples.length;
  if (!n) return { value: 0, n: 0, se: 0 };
  const mean = samples.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? samples.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const round1 = (x: number) => Math.round(x * 1000) / 10;
  return { value: round1(mean), n, se: round1(Math.sqrt(variance / n)) };
}

/**
 * Where a set of decisions sits against the charts, compared with what the charts would do in the
 * same spots, so playing the charts' own mix lands at the centre on average:
 * - x (loose): where folding was possible, "continued" (1 or 0) minus the chart's continue frequency.
 * - y (aggressive): where betting or raising was possible, "bet or raised" (1 or 0) minus the chart's
 *   frequency for those actions.
 */
function pointOf(decisions: DecisionFeedback[]): StylePoint {
  const x: number[] = [];
  const y: number[] = [];
  for (const d of decisions) {
    const fold = d.options.find((o) => o.actionId === 'fold');
    if (fold) x.push((d.chosenAction === 'fold' ? 0 : 1) - (1 - fold.frequency));
    const aggressive = d.options.filter((o) => AGGRESSIVE.has(o.actionId as ActionType));
    if (aggressive.length) {
      const chart = aggressive.reduce((s, o) => s + o.frequency, 0);
      y.push((AGGRESSIVE.has(d.chosenAction) ? 1 : 0) - chart);
    }
  }
  return { x: axisOf(x), y: axisOf(y) };
}

export function styleOf(decisions: DecisionFeedback[]): PlayerStyle {
  const bySpot = new Map<SpotType, DecisionFeedback[]>();
  for (const d of decisions) {
    const spot = spotTypeOf(d.nodeKey);
    bySpot.set(spot, [...(bySpot.get(spot) ?? []), d]);
  }
  return {
    overall: pointOf(decisions),
    bySpot: [...bySpot].map(([spot, ds]) => ({ spot, label: spotLabel(spot), ...pointOf(ds) })).filter((p) => p.x.n || p.y.n),
  };
}

/** Share graded best or mixed, and the average EV given up where the options carry EVs. */
export function gtoSummaryOf(decisions: DecisionFeedback[]): GtoSummary {
  const accurate = decisions.filter((d) => d.grade !== 'mistake').length;
  let lost = 0;
  let evDecisions = 0;
  for (const d of decisions) {
    const evs = d.options.map((o) => o.evBb);
    const chosen = d.options.find((o) => o.actionId === d.chosenAction)?.evBb;
    if (chosen == null || evs.some((e) => e == null)) continue;
    lost += Math.max(...(evs as number[])) - chosen;
    evDecisions++;
  }
  return {
    accuracy: decisions.length ? Math.round((accurate / decisions.length) * 1000) / 1000 : 0,
    evLossBb: evDecisions ? Math.round((lost / evDecisions) * 1000) / 1000 : null,
    evDecisions,
  };
}
