import { handClass } from '../poker/cards.js';
import { cardStr, parseCards, type Card, type CardMapper } from './flopMap.js';
import type { FlopNode, LoadedFlop } from './flopStore.js';

/**
 * Live turn and river solving (docs/postflop-plan.md, "Live turn and river solving"): the request
 * the solver service takes and the result it returns, plus how a request is built from the flop
 * the hand was played on. The service is a separate AGPL program (solver/src/bin/live.rs); only
 * this JSON crosses between it and the API.
 */

/** solver/src/live.rs `LiveRequest`. Cards are in the solved flop's suits and ranks. */
export interface LiveRequest {
  board: string[];
  hands: [string[], string[]];
  ranges: [number[], number[]];
  potBb: number;
  stackBb: number;
  chipsPerBb: number;
  turn: [string, string];
  river: [string, string];
  riverCards: string[];
  accuracyPct: number;
}

/** solver/src/live.rs `LiveOut`; nodes use the flop files' format. */
export interface LiveOut {
  board: string[];
  hands: [string[], string[]];
  exploitabilityPctPot: number;
  nodes: FlopNode[];
  rivers: { turnLine: number[]; card: string; nodes: FlopNode[] }[];
}

/** The spot settings the batch solver saved next to its flops (`<spot>/_spot.json`). */
export interface SpotInfo {
  chips_per_bb: number;
  pot_bb: number;
  stack_bb: number;
  oop_range: string;
  ip_range: string;
}

/**
 * Turn and river bet sizes: 33/75/125% on the turn and 50/100%/all-in on the river, with one 3x
 * raise. Limped pots drop the raise: their wide ranges made that tree take 18s (Measured, 2026-10-10).
 */
const LIVE_TREE = { turn: ['33%,75%,125%', '3x'], river: ['50%,100%,a', '3x'] } as const;
const LIVE_TREE_LIMPED = { turn: ['33%,75%,125%', ''], river: ['50%,100%,a', ''] } as const;
export const liveTree = (spot: string) => (/_limp_/.test(spot) ? LIVE_TREE_LIMPED : LIVE_TREE);

/** "22:0.993,AKs,A2o:0.5" -> hand class weights (classes not listed are 0). */
export function parseRange(range: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const part of range.split(',')) {
    const [hc, w] = part.trim().split(':');
    if (!hc) continue;
    const weight = w === undefined ? 1 : Number(w);
    // "AK" without s/o means both.
    if (hc.length === 2 && hc[0] !== hc[1]) {
      m.set(`${hc}s`, weight);
      m.set(`${hc}o`, weight);
    } else m.set(hc, weight);
  }
  return m;
}

export interface TurnStart {
  /** Per player, per hand of the flop file: preflop weight x each flop action's frequency on the line. */
  ranges: [number[], number[]];
  potBb: number;
  stackBb: number;
}

/**
 * Each player's range, the pot and the stacks when the turn comes after `line` (flop action
 * indexes); null when the line doesn't reach the turn (a fold, more flop betting, or all-in).
 * Same formula as `live::turn_start` in the solver. The flop files' own `weights` can't be used:
 * they include the opponent's card removal, so blockers would count twice.
 */
export function turnStart(data: LoadedFlop, spot: SpotInfo, line: number[]): TurnStart | null {
  const preflop = [parseRange(spot.oop_range), parseRange(spot.ip_range)];
  const ranges = [0, 1].map((p) => data.hands[p].map((h) => preflop[p].get(handClass(h.slice(0, 2), h.slice(2))) ?? 0)) as [number[], number[]];
  const street = [0, 0];
  for (let k = 0; k < line.length; k++) {
    const node = data.byHistory.get(line.slice(0, k).join('.'));
    const label = node?.actions[line[k]];
    if (!node || !label) return null;
    const p = node.player;
    ranges[p] = ranges[p].map((r, h) => (r * node.strategy[line[k]][h]) / 1000);
    const [kind, amount] = label.split(' ');
    if (kind === 'fold') return null;
    if (kind === 'call') street[p] = street[1 - p];
    else if (kind !== 'check') street[p] = Number(amount);
  }
  if (data.byHistory.has(line.join('.')) || Math.abs(street[0] - street[1]) > 0.01) return null;
  const stackBb = Math.round((spot.stack_bb - street[0]) * 100) / 100;
  if (stackBb <= 0) return null;
  return { ranges, potBb: Math.round((spot.pot_bb + 2 * street[0]) * 100) / 100, stackBb };
}

/**
 * A real turn or river card on the solved board. Mapping keeps it from landing on the solved
 * flop, but two cards dealt later can map onto one; then the nearest free rank of the same suit is used.
 */
export function mapBoardCard(mapper: CardMapper, card: string, used: string[]): string {
  const m = mapper.card(parseCards(card)[0]);
  const taken = new Set(used);
  if (!taken.has(cardStr(m))) return cardStr(m);
  for (let step = 1; step < 13; step++) {
    for (const r of [m.r - step, m.r + step]) {
      const c: Card = { r, s: m.s };
      if (r >= 0 && r <= 12 && !taken.has(cardStr(c))) return cardStr(c);
    }
  }
  throw new Error(`no free card for ${card}`);
}

/** The solve request for a turn after `line`, with hands nobody holds left out to keep it small. */
export function turnRequest(data: LoadedFlop, spot: SpotInfo, spotName: string, line: number[], turn: string, river: string): LiveRequest | null {
  const start = turnStart(data, spot, line);
  if (!start) return null;
  const keep = start.ranges.map((r) => r.flatMap((w, h) => (w > 0 ? [h] : [])));
  const tree = liveTree(spotName);
  return {
    board: [...(data.flop.match(/../g) ?? []), turn],
    hands: [keep[0].map((h) => data.hands[0][h]), keep[1].map((h) => data.hands[1][h])],
    ranges: [keep[0].map((h) => Math.round(start.ranges[0][h] * 1e5) / 1e5), keep[1].map((h) => Math.round(start.ranges[1][h] * 1e5) / 1e5)],
    potBb: start.potBb,
    stackBb: start.stackBb,
    chipsPerBb: spot.chips_per_bb,
    turn: [...tree.turn],
    river: [...tree.river],
    riverCards: [river],
    accuracyPct: 1,
  };
}
