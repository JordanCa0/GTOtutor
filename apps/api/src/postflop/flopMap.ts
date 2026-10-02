/**
 * Maps a real flop onto the closest solved flop, and a hand on the real flop onto the hand that
 * plays the same role on the solved flop. Solved flops come from `solver/` (canonical names like
 * "Kh7d2c"); this lets a spot with only a sample of flops solved answer for any flop.
 */

const RANKS = '23456789TJQKA';
/** postflop-solver's suit order; also used to write canonical flop names. */
const SUITS = 'cdhs';

export interface Card {
  r: number; // 0 = deuce .. 12 = ace
  s: number; // index into SUITS
}

export const parseCard = (c: string): Card => {
  const r = RANKS.indexOf(c[0]);
  const s = SUITS.indexOf(c[1]);
  if (r < 0 || s < 0) throw new Error(`bad card ${c}`);
  return { r, s };
};
export const cardStr = (c: Card) => RANKS[c.r] + SUITS[c.s];
export const parseCards = (s: string): Card[] => (s.match(/../g) ?? []).map(parseCard);

/**
 * A flop in a fixed order (ranks high to low, ties broken so the suit pattern is canonical) with
 * its suit pattern, e.g. "aab" = the top two cards share a suit.
 */
export interface Shape {
  cards: Card[];
  pattern: string;
  /** "U" unpaired, "P" top pair (KK2), "L" low pair (K22), "T" trips. */
  pairing: string;
}

function suitPattern(cards: Card[]): string {
  const seen: number[] = [];
  return cards
    .map((c) => {
      if (!seen.includes(c.s)) seen.push(c.s);
      return 'abc'[seen.indexOf(c.s)];
    })
    .join('');
}

export function shapeOf(flop: Card[]): Shape {
  if (flop.length !== 3) throw new Error('a flop has three cards');
  const sorted = [...flop].sort((a, b) => b.r - a.r);
  // Equal ranks can be listed in either order; take the order with the smallest pattern string.
  const orders: Card[][] = [sorted];
  const [x, y, z] = sorted;
  if (x.r === y.r) orders.push([y, x, z]);
  if (y.r === z.r) orders.push([x, z, y]);
  if (x.r === y.r && y.r === z.r) orders.push([y, z, x], [z, x, y], [z, y, x]);
  let best = orders[0];
  for (const o of orders) if (suitPattern(o) < suitPattern(best)) best = o;
  const pairing = x.r === z.r ? 'T' : x.r === y.r ? 'P' : y.r === z.r ? 'L' : 'U';
  return { cards: best, pattern: suitPattern(best), pairing };
}

/** How different two flops of the same shape play: high cards and gaps matter most. */
export function flopDistance(a: Shape, b: Shape): number {
  const [a1, a2, a3] = a.cards.map((c) => c.r);
  const [b1, b2, b3] = b.cards.map((c) => c.r);
  return (
    2 * Math.abs(a1 - b1) +
    1.5 * Math.abs(a2 - b2) +
    Math.abs(a3 - b3) +
    Math.abs(a1 - a2 - (b1 - b2)) +
    Math.abs(a2 - a3 - (b2 - b3))
  );
}

/** Picks the solved flop closest to `flop`; only flops with the same suit and pairing shape qualify. */
export function nearestFlop(flop: Card[], solved: string[]): { flop: string; distance: number } | null {
  const target = shapeOf(flop);
  let best: { flop: string; distance: number } | null = null;
  for (const name of solved) {
    const s = shapeOf(parseCards(name));
    if (s.pattern !== target.pattern || s.pairing !== target.pairing) continue;
    const d = flopDistance(target, s);
    if (!best || d < best.distance) best = { flop: name, distance: d };
  }
  return best;
}

/**
 * Translates hole cards from the real flop to the solved flop: suits follow the board's suits,
 * board ranks map to board ranks, and other ranks keep their place between the board cards.
 */
export class CardMapper {
  private suitMap: number[];
  private from: number[]; // distinct board ranks, high to low
  private to: number[];

  constructor(real: Card[], solved: Card[]) {
    const a = shapeOf(real);
    const b = shapeOf(solved);
    if (a.pattern !== b.pattern || a.pairing !== b.pairing) throw new Error('flops have different shapes');
    this.suitMap = [-1, -1, -1, -1];
    a.cards.forEach((c, i) => (this.suitMap[c.s] = b.cards[i].s));
    const free = [0, 1, 2, 3].filter((s) => !this.suitMap.includes(s));
    for (let s = 0; s < 4; s++) if (this.suitMap[s] < 0) this.suitMap[s] = free.shift()!;
    this.from = [...new Set(a.cards.map((c) => c.r))];
    this.to = [...new Set(b.cards.map((c) => c.r))];
  }

  rank(r: number): number {
    const j = this.from.indexOf(r);
    if (j >= 0) return this.to[j];
    // Slot between two board ranks (13 above the top card, -1 below the bottom one).
    const bounds = (ranks: number[]) => [13, ...ranks, -1];
    const f = bounds(this.from);
    const t = bounds(this.to);
    let k = 0;
    while (!(r < f[k] && r > f[k + 1])) k++;
    const pos = (r - f[k + 1]) / (f[k] - f[k + 1]);
    const lo = t[k + 1];
    const hi = t[k];
    if (hi - lo >= 2) return Math.min(hi - 1, Math.max(lo + 1, Math.round(lo + pos * (hi - lo))));
    // The solved board has no gap here: use the closest rank that isn't on the board.
    for (let step = 1; step < 13; step++) {
      for (const cand of [lo - step + 1, hi + step - 1]) if (cand >= 0 && cand <= 12 && !this.to.includes(cand)) return cand;
    }
    return lo;
  }

  card(c: Card): Card {
    return { r: this.rank(c.r), s: this.suitMap[c.s] };
  }
}

/** Index of a hand in a solved hand list (strings like "AsKh", either card order). */
export function handIndex(hands: string[]): Map<string, number> {
  const m = new Map<string, number>();
  hands.forEach((h, i) => {
    m.set(h, i);
    m.set(h.slice(2) + h.slice(0, 2), i);
  });
  return m;
}

/**
 * The solved hand that plays like `hole` does on the real board. Falls back to the closest hand in
 * the solved range when the exact translation isn't there (e.g. two ranks landed on one).
 */
export function mapHand(hole: Card[], mapper: CardMapper, solvedHands: string[], index: Map<string, number>): number {
  const [m1, m2] = hole.map((c) => mapper.card(c));
  const exact = index.get(cardStr(m1) + cardStr(m2));
  if (exact !== undefined) return exact;
  const pair = hole[0].r === hole[1].r;
  const suited = hole[0].s === hole[1].s;
  let best = -1;
  let bestCost = Infinity;
  solvedHands.forEach((h, i) => {
    const [x, y] = parseCards(h);
    if (pair !== (x.r === y.r) || suited !== (x.s === y.s)) return;
    const flushMatch = (x.s === m1.s ? 0 : 1) + (y.s === m2.s ? 0 : 1);
    const flushSwap = (x.s === m2.s ? 0 : 1) + (y.s === m1.s ? 0 : 1);
    const straight = Math.abs(x.r - m1.r) + Math.abs(y.r - m2.r);
    const swapped = Math.abs(x.r - m2.r) + Math.abs(y.r - m1.r);
    const cost = Math.min(straight + 3 * flushMatch, swapped + 3 * flushSwap);
    if (cost < bestCost) {
      bestCost = cost;
      best = i;
    }
  });
  return best;
}
