import type { Archetype, LegalAction } from '@gtotutor/shared-types';
import type { ChartNode } from '../charts/types.js';
import { ALL_HAND_CLASSES } from '../poker/cards.js';

/** Bump when a definition below changes: cached Jev answers for older definitions are dropped. */
export const ARCHETYPE_DEFS_VERSION = 'a2';

export interface ArchetypeDef {
  /** Who this player is, as JEV AI is told (docs/archetypes.md). */
  description: string;
  /** How they play after the flop, as JEV AI is told. */
  postflop: string;
  /** Their tendencies in a few words, for the coach. */
  coach: string;
  /**
   * The rules used until JEV AI has answered (or without a key). Looseness scales how many hands
   * are played (1 = the chart), aggression the odds of raising over calling, and newHandRaise is
   * how often a hand the chart never plays is raised rather than called.
   */
  looseness: number;
  aggression: number;
  newHandRaise: number;
}

export const ARCHETYPE_DEFS: Record<Archetype, ArchetypeDef> = {
  fish: {
    description:
      'A recreational "fish" at a low-stakes live game. Plays about 40-50% of hands overall (a balanced player plays about 25%): any pair, any ace, any two suited cards, most connected cards and most hands with a picture card. Prefers limping and calling to raising, raises first in only with big pairs and big aces, and calls raises far too wide. Still folds the clearly bad hands: weak offsuit hands with no picture card or connection, such as 72o, 83o, 94o, T3o, J2o.',
    postflop: 'Calls far too often, chases any draw, almost never folds a pair, rarely bluffs, bets small with strong hands and only raises with a monster.',
    coach: 'plays far too many hands, limps and calls too much, chases draws, rarely bluffs, rarely folds a pair',
    looseness: 2,
    aggression: 0.35,
    newHandRaise: 0.1,
  },
  nit: {
    description:
      'A "nit": extremely tight and cautious. Plays about 10-12% of hands overall: good pairs, strong aces (AJ or better) and the best broadway hands, a little more on the button. Folds speculative hands such as small suited connectors, weak suited aces and small pairs out of position. Re-raises only with the very best hands (QQ+, AK).',
    postflop: 'Continues only with strong hands, folds to bets and raises without a big hand, almost never bluffs, and bets big only when very strong.',
    coach: 'plays only strong hands, folds to pressure without a big hand, almost never bluffs, so big bets and raises mean strength',
    looseness: 0.5,
    aggression: 0.8,
    newHandRaise: 0.5,
  },
  lag: {
    description:
      'A loose-aggressive regular (LAG): about 30-35% of hands overall, opening roughly half again as many hands as a balanced player from each seat (more on the button and cutoff, fewer under the gun). Adds suited connectors, suited gappers, suited aces and kings and the better offsuit broadways. Prefers raising and re-raising to calling, 3-bets light with suited hands, never limps. Still folds weak offsuit trash such as 72o, 93o, Q4o, K3o.',
    postflop: 'Bets and raises often, bluffs with draws and with nothing on scary cards, keeps up pressure across streets, and gives up when raised big without equity.',
    coach: 'plays wide, raises and 3-bets light, bluffs often and keeps up pressure across streets',
    looseness: 1.6,
    aggression: 1.8,
    newHandRaise: 0.7,
  },
  tag: {
    description:
      'A tight-aggressive regular (TAG): solid and disciplined, close to a balanced player but a little tighter: about 20-22% of hands overall. Opens slightly fewer hands than a balanced player from each seat, dropping the weakest offsuit hands first but keeping suited aces, suited connectors and pairs in late position. Raises rather than limps or calls, and 3-bets strong hands.',
    postflop: 'Continuation-bets often, bets strong hands for value, semi-bluffs good draws, and folds weak hands to aggression.',
    coach: 'solid: a fairly tight range played aggressively, c-bets often, folds weak hands to aggression',
    looseness: 0.9,
    aggression: 1.25,
    newHandRaise: 0.6,
  },
};

export type Bucket = 'out' | 'passive' | 'aggressive';
/** Check is the free option (BB facing a limp): it puts no money in, like a fold. */
export const bucketOf = (a: LegalAction): Bucket => (a.id === 'fold' || a.id === 'check' ? 'out' : a.id === 'call' ? 'passive' : 'aggressive');

/** The Chen formula: a quick preflop hand strength score, -1 (72o) to 20 (AA). */
export function chenScore(handClass: string): number {
  const ranks = '23456789TJQKA';
  const hi = ranks.indexOf(handClass[0]);
  const lo = ranks.indexOf(handClass[1]);
  const card = (r: number) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  if (hi === lo) return Math.max(5, card(hi) * 2);
  let score = card(hi);
  if (handClass[2] === 's') score += 2;
  const gap = hi - lo - 1;
  score -= [0, 1, 2, 4][gap] ?? 5;
  if (gap <= 1 && hi < 10) score += 1;
  return Math.ceil(score);
}

/** Chen score scaled to 0..1. */
export const handStrength = (handClass: string) => (chenScore(handClass) + 1) / 21;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Combos of a hand class: 6 for a pair, 4 suited, 12 offsuit. */
export const combos = (handClass: string) => (handClass.length === 2 ? 6 : handClass[2] === 's' ? 4 : 12);

/** Half the width of the strength band over which a tight type drops the chart's hands. */
const CUT_BAND = 0.05;
const cuts = new WeakMap<ChartNode, Map<number, number>>();

/**
 * The strength below which a tight type (looseness < 1) drops the chart's hands at this node, so
 * that it keeps `looseness` of the combos the chart plays there: a nit at half keeps about 10% from
 * UTG and 20% on the button, where a fixed cut would play the same 9% everywhere.
 */
function strengthCut(node: ChartNode, looseness: number, playOf: (hc: string) => number): number {
  let byLooseness = cuts.get(node);
  if (!byLooseness) cuts.set(node, (byLooseness = new Map()));
  const memo = byLooseness.get(looseness);
  if (memo !== undefined) return memo;
  const hands = ALL_HAND_CLASSES.map((hc) => ({ w: combos(hc) * playOf(hc), s: handStrength(hc) }));
  const total = hands.reduce((s, h) => s + h.w, 0);
  const kept = (cut: number) => hands.reduce((s, h) => s + h.w * smoothstep(cut - CUT_BAND, cut + CUT_BAND, h.s), 0);
  let lo = -CUT_BAND;
  let hi = 1 + CUT_BAND;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (kept(mid) > looseness * total) lo = mid;
    else hi = mid;
  }
  byLooseness.set(looseness, lo);
  return lo;
}

/** How often the archetype plays (doesn't fold) a hand the chart plays `play` of the time. */
function playFrequency(def: ArchetypeDef, play: number, strength: number, cut: () => number): number {
  if (def.looseness >= 1) return play + (1 - play) * Math.min(1, (def.looseness - 1) * strength * 1.2);
  const c = cut();
  return play * smoothstep(c - CUT_BAND, c + CUT_BAND, strength);
}

/** Spreads `mass` over the actions of one bucket, in the chart's proportions (or all on the first). */
function spread(out: number[], actions: LegalAction[], chart: number[], bucket: Bucket, mass: number): void {
  const idx = actions.map((a, i) => (bucketOf(a) === bucket ? i : -1)).filter((i) => i >= 0);
  if (!idx.length || mass <= 0) return;
  const total = idx.reduce((s, i) => s + chart[i], 0);
  for (const i of idx) out[i] += total > 0 ? (mass * chart[i]) / total : i === idx[0] ? mass : 0;
}

/**
 * The archetype's frequencies for one hand at a chart node, from the chart's own: plays more or
 * fewer hands (stronger hands first, by Chen score), then shifts the mix between calling and raising.
 * The fallback for JEV AI, and the baseline its answers are blended with.
 */
export function ruleFrequencies(archetype: Archetype, node: ChartNode, handClass: string): number[] {
  const def = ARCHETYPE_DEFS[archetype];
  const chart = node.strategy.get(handClass) ?? node.actions.map((_, i) => (i === 0 ? 1 : 0));
  const sum = (b: Bucket) => node.actions.reduce((s, a, i) => s + (bucketOf(a) === b ? chart[i] : 0), 0);
  const has = (b: Bucket) => node.actions.some((a) => bucketOf(a) === b);
  // A node with nothing but folds and checks, or nothing but ways to play: nothing to adjust.
  if (!has('out') || (!has('passive') && !has('aggressive'))) return [...chart];
  const chartPlay = sum('passive') + sum('aggressive');
  const playOf = (hc: string) => {
    const f = node.strategy.get(hc);
    return f ? f.reduce((s, x, i) => s + (bucketOf(node.actions[i]) === 'out' ? 0 : x), 0) : 0;
  };
  const play = playFrequency(def, chartPlay, handStrength(handClass), () => strengthCut(node, def.looseness, playOf));
  let raiseShare = chartPlay > 0 ? sum('aggressive') / chartPlay : def.newHandRaise;
  raiseShare = Math.min(0.98, Math.max(0.02, raiseShare));
  const odds = (raiseShare / (1 - raiseShare)) * def.aggression;
  raiseShare = !has('passive') ? 1 : !has('aggressive') ? 0 : odds / (1 + odds);
  const out = node.actions.map(() => 0);
  spread(out, node.actions, chart, 'out', 1 - play);
  spread(out, node.actions, chart, 'passive', play * (1 - raiseShare));
  spread(out, node.actions, chart, 'aggressive', play * raiseShare);
  return out;
}
