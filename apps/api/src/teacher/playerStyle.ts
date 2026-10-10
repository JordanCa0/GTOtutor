import type { ActionType, DecisionFeedback, GtoSummary, PlayerStyle, SpotType, StyleAxis, StyleLeakRate, StyleLeakRates, StylePoint } from '@gtotutor/shared-types';
import { spotLabel, spotTypeOf } from './sessionStats.js';

const AGGRESSIVE = new Set<ActionType>(['bet', 'raise', 'allin']);

/** A share (0–1) as a percentage with one decimal. */
const round1 = (x: number) => Math.round(x * 1000) / 10;

/** One decision on one axis: what the player did (1 or 0) and the chart's frequency for it. */
interface Sample {
  you: number;
  chart: number;
}

/** Mean difference in percentage points with its standard error, plus both sides' rates. */
function axisOf(samples: Sample[]): StyleAxis {
  const n = samples.length;
  if (!n) return { value: 0, n: 0, se: 0, you: 0, chart: 0 };
  const diffs = samples.map((s) => s.you - s.chart);
  const mean = diffs.reduce((a, b) => a + b, 0) / n;
  const variance = n > 1 ? diffs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const avg = (k: keyof Sample) => samples.reduce((a, s) => a + s[k], 0) / n;
  return { value: round1(mean), n, se: round1(Math.sqrt(variance / n)), you: round1(avg('you')), chart: round1(avg('chart')) };
}

/**
 * Where a set of decisions sits against the charts, compared with what the charts would do in the
 * same spots, so playing the charts' own mix lands at the centre on average:
 * - x (loose): where folding was possible, "continued" (1 or 0) minus the chart's continue frequency.
 * - y (aggressive): where betting or raising was possible, "bet or raised" (1 or 0) minus the chart's
 *   frequency for those actions.
 */
function pointOf(decisions: DecisionFeedback[]): StylePoint {
  const x: Sample[] = [];
  const y: Sample[] = [];
  for (const d of decisions) {
    const fold = d.options.find((o) => o.actionId === 'fold');
    if (fold) x.push({ you: d.chosenAction === 'fold' ? 0 : 1, chart: 1 - fold.frequency });
    const aggressive = d.options.filter((o) => AGGRESSIVE.has(o.actionId as ActionType));
    if (aggressive.length) y.push({ you: AGGRESSIVE.has(d.chosenAction) ? 1 : 0, chart: aggressive.reduce((s, o) => s + o.frequency, 0) });
  }
  return { x: axisOf(x), y: axisOf(y) };
}

/**
 * The two directions the x axis nets out, weighted by the charts' own mix rather than a cutoff: a spot
 * the charts fold 70% of the time counts as 0.7 of a "chart fold" and 0.3 of a "chart play".
 * - played chart folds: continuing, weighted by the chart's fold frequency, over all that fold weight;
 * - folded chart plays: folding, weighted by the chart's continue frequency, over all that weight.
 */
function leaksOf(decisions: DecisionFeedback[]): StyleLeakRates {
  let foldWeight = 0;
  let played = 0;
  let playWeight = 0;
  let folded = 0;
  for (const d of decisions) {
    const fold = d.options.find((o) => o.actionId === 'fold');
    if (!fold) continue;
    const continued = d.chosenAction !== 'fold';
    foldWeight += fold.frequency;
    playWeight += 1 - fold.frequency;
    if (continued) played += fold.frequency;
    else folded += 1 - fold.frequency;
  }
  const rate = (part: number, whole: number): StyleLeakRate => ({ rate: whole ? round1(part / whole) : 0, weight: Math.round(whole * 10) / 10 });
  return { playedChartFolds: rate(played, foldWeight), foldedChartPlays: rate(folded, playWeight) };
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
    leaks: leaksOf(decisions),
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
