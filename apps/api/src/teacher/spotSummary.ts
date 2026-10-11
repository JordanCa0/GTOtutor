import { handClass, rankIndex } from '../poker/cards.js';
import { POSTFLOP_GROUPS, PREFLOP_GROUPS, postflopGroup, preflopGroup } from './handGroups.js';

/**
 * Both ranges at a decision, as the coach sees them (docs/future-ideas.md, "Coach sees the whole
 * solver output"): hero's range with its strategy, and villain's range when it's known. Built by
 * `HandEngine.spotRanges` from the chart, the flop file or the live solve.
 */
export interface SpotRanges {
  /** "chart" before the flop, "solver" after it (CLAUDE.md wording rule). */
  source: 'chart' | 'solver';
  /** The board the strategy is on (the solved board postflop); empty preflop. */
  board: string[];
  /** Hero's option labels, aligned with `hero.strategy`. */
  actions: string[];
  hero: {
    /** Hand classes ("AKs") preflop, combos ("AhKd") postflop. */
    hands: string[];
    /** How much of each hand reaches this decision (combos preflop). */
    weights: number[];
    /** Per action, per hand: frequency 0-1. */
    strategy: number[][];
    /** Per action, per hand: EV in bb, when the data has EVs. */
    ev: (number | null)[][] | null;
  };
  villain: { position: string; hands: string[]; weights: number[] } | null;
}

const pct = (x: number) => Math.round(x * 1000) / 10;
const fmt = (x: number) => `${pct(x)}%`;
const classOf = (hand: string) => (hand.length === 4 ? handClass(hand.slice(0, 2), hand.slice(2)) : hand);

function groupOf(r: SpotRanges, hand: string): string {
  return r.board.length ? postflopGroup([hand.slice(0, 2), hand.slice(2)], r.board).group : preflopGroup(hand);
}

interface Mix {
  weight: number;
  freq: number[];
  ev: number[];
  evWeight: number[];
}

/** Weighted strategy and EV over a set of hero's hands; unweighted when none of them reach here. */
function mixOf(r: SpotRanges, idx: number[]): Mix {
  const total = idx.reduce((s, h) => s + r.hero.weights[h], 0);
  const w = (h: number) => (total > 0 ? r.hero.weights[h] : 1);
  const m: Mix = { weight: total, freq: r.actions.map(() => 0), ev: r.actions.map(() => 0), evWeight: r.actions.map(() => 0) };
  let sum = 0;
  for (const h of idx) {
    sum += w(h);
    r.actions.forEach((_, a) => {
      m.freq[a] += r.hero.strategy[a][h] * w(h);
      const ev = r.hero.ev?.[a][h];
      if (ev != null && Number.isFinite(ev)) {
        m.ev[a] += ev * w(h);
        m.evWeight[a] += w(h);
      }
    });
  }
  m.freq = m.freq.map((f) => (sum ? f / sum : 0));
  m.ev = m.ev.map((e, a) => (m.evWeight[a] ? e / m.evWeight[a] : NaN));
  return m;
}

function describeMix(r: SpotRanges, m: Mix, percents: number[], withEv = true): string {
  const parts = r.actions.map((a, i) => ({ a, f: m.freq[i] })).filter((x) => x.f >= 0.005);
  parts.forEach((x) => percents.push(pct(x.f)));
  const evs = r.actions.flatMap((a, i) => (withEv && Number.isFinite(m.ev[i]) ? [`${a} ${Math.round(m.ev[i] * 100) / 100}bb`] : []));
  return `${parts.map((x) => `${x.a} ${fmt(x.f)}`).join(', ')}${evs.length ? ` (EV ${evs.join(', ')})` : ''}`;
}

function groupShares(hands: string[], weights: number[], group: (hand: string) => string): Map<string, { share: number; idx: number[] }> {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const out = new Map<string, { share: number; idx: number[] }>();
  hands.forEach((hand, i) => {
    const g = group(hand);
    const e = out.get(g) ?? { share: 0, idx: [] };
    e.share += weights[i] / total;
    e.idx.push(i);
    out.set(g, e);
  });
  return out;
}

const ordered = <T>(m: Map<string, T>, board: string[]) =>
  [...(board.length ? POSTFLOP_GROUPS : PREFLOP_GROUPS)].flatMap((g) => (m.has(g) ? [[g, m.get(g)!] as const] : []));

/**
 * The compact text the coach gets (about 10-20 lines), and every percentage in it, which go on
 * the grounding check's allowed list. `heroClass` is hero's hand class, for its neighbours.
 */
export function summarizeSpot(r: SpotRanges, hero: { handClass: string; group: string | null }): { text: string; percents: number[] } {
  const percents: number[] = [];
  const who = r.source === 'chart' ? 'the chart' : 'the solver';
  const lines: string[] = [];

  const heroGroups = groupShares(r.hero.hands, r.hero.weights, (h) => groupOf(r, h));
  lines.push(
    r.board.length
      ? `Hero's range at this decision by hand group (share of the range, then how ${who} plays it):`
      : `Starting hands by group (share of all hands, then how ${who} plays them here):`,
  );
  for (const [g, { share, idx }] of ordered(heroGroups, r.board)) {
    if (share < 0.005) continue;
    percents.push(pct(share));
    lines.push(`- ${g}: ${fmt(share)} of ${r.board.length ? 'range' : 'hands'}. ${describeMix(r, mixOf(r, idx), percents)}`);
  }

  if (hero.group) lines.push(`Hero's own hand is in the group "${hero.group}".`);

  // Hands next to hero's in the same group: same suitedness first, then by rank distance.
  const group = heroGroups.get(hero.group ?? '');
  if (group) {
    const byClass = new Map<string, number[]>();
    for (const h of group.idx) {
      const hc = classOf(r.hero.hands[h]);
      if (hc !== hero.handClass) byClass.set(hc, [...(byClass.get(hc) ?? []), h]);
    }
    const dist = (hc: string) =>
      Math.abs(rankIndex(hc[0]) - rankIndex(hero.handClass[0])) + Math.abs(rankIndex(hc[1]) - rankIndex(hero.handClass[1])) + (hc[2] === hero.handClass[2] ? 0 : 3);
    const near = [...byClass.keys()].sort((a, b) => dist(a) - dist(b)).slice(0, 6);
    if (near.length) {
      lines.push(`Hands near hero's in that group: ${near.map((hc) => `${hc}: ${describeMix(r, mixOf(r, byClass.get(hc)!), percents, false)}`).join('; ')}.`);
    }
  }

  if (r.villain) {
    const vGroups = groupShares(r.villain.hands, r.villain.weights, (h) => groupOf(r, h));
    const parts = ordered(vGroups, r.board).filter(([, v]) => v.share >= 0.005);
    parts.forEach(([, v]) => percents.push(pct(v.share)));
    lines.push(`${r.villain.position}'s range at this point (what hero is up against), by hand group: ${parts.map(([g, v]) => `${g} ${fmt(v.share)}`).join(', ')}.`);
  } else {
    lines.push("Villain's range at this point isn't available.");
  }
  return { text: lines.join('\n'), percents };
}

/**
 * One hand's numbers for the coach's lookup tool: a class ("AKs", "77") or a combo ("AsKd"), in
 * hero's range (strategy and EV) or villain's (share and group).
 */
export function lookupHand(r: SpotRanges, query: string, player: 'hero' | 'villain'): { text: string; percents: number[] } {
  const q = query.trim();
  const isCombo = /^([2-9TJQKA][shdc]){2}$/i.test(q);
  const isClass = /^[2-9TJQKA]{2}[so]?$/i.test(q);
  if (!isCombo && !isClass) return { text: `"${q}" isn't a hand. Use a class like AKs, T9o or 77, or two cards like AsKd.`, percents: [] };
  const combo = isCombo ? q[0].toUpperCase() + q[1].toLowerCase() + q[2].toUpperCase() + q[3].toLowerCase() : '';
  // Preflop ranges are hand classes, so two cards are looked up as their class.
  const asCombo = isCombo && r.board.length > 0;
  const norm = asCombo ? combo : isCombo ? handClass(combo.slice(0, 2), combo.slice(2)) : q[0].toUpperCase() + q[1].toUpperCase() + (q[2] ?? '').toLowerCase();
  const matches = (hand: string) =>
    asCombo ? hand === norm || hand === norm.slice(2) + norm.slice(0, 2) : norm.length === 2 && norm[0] !== norm[1] ? classOf(hand).slice(0, 2) === norm : classOf(hand) === norm;
  const percents: number[] = [];

  if (player === 'villain') {
    if (!r.villain) return { text: "Villain's range isn't available for this decision.", percents };
    const total = r.villain.weights.reduce((a, b) => a + b, 0) || 1;
    const idx = r.villain.hands.flatMap((h, i) => (matches(h) ? [i] : []));
    const share = idx.reduce((s, i) => s + r.villain!.weights[i], 0) / total;
    percents.push(pct(share));
    const groups = [...new Set(idx.filter((i) => r.villain!.weights[i] > 0).map((i) => groupOf(r, r.villain!.hands[i])))];
    return { text: `${norm} in ${r.villain.position}'s range: ${fmt(share)} of the range${groups.length ? ` (${groups.join(', ')})` : ', so it never gets here'}.`, percents };
  }

  const idx = r.hero.hands.flatMap((h, i) => (matches(h) ? [i] : []));
  if (!idx.length) return { text: `${norm} isn't one of hero's possible hands here (it's not in the range, or it clashes with the board).`, percents };
  const total = r.hero.weights.reduce((a, b) => a + b, 0) || 1;
  const m = mixOf(r, idx);
  const share = m.weight / total;
  percents.push(pct(share));
  const groups = [...new Set(idx.map((i) => groupOf(r, r.hero.hands[i])))];
  const reach = share > 0 ? `${fmt(share)} of hero's range` : `not in hero's range here (${r.source === 'chart' ? 'the chart' : 'the solver'} still has a strategy for it)`;
  return { text: `${norm} for hero: ${reach}; group ${groups.join(', ')}. ${describeMix(r, m, percents)}.`, percents };
}
