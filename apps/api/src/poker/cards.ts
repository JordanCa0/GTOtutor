import type { Rng } from './rng.js';

export const RANKS = '23456789TJQKA';
export const SUITS = 'shdc';

export const rankIndex = (card: string) => RANKS.indexOf(card[0]);
export const suitOf = (card: string) => card[1];

export function fullDeck(): string[] {
  const deck: string[] = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

/** Fisher–Yates, in place. */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** Maps two hole cards to one of the 169 canonical classes, e.g. "AKs", "T9o", "77". */
export function handClass(c1: string, c2: string): string {
  const [hi, lo] = rankIndex(c1) >= rankIndex(c2) ? [c1, c2] : [c2, c1];
  if (hi[0] === lo[0]) return hi[0] + lo[0];
  return hi[0] + lo[0] + (suitOf(hi) === suitOf(lo) ? 's' : 'o');
}

export function comboCount(hc: string): number {
  if (hc.length === 2) return 6;
  return hc[2] === 's' ? 4 : 12;
}

/** All 169 classes in 13x13 grid order (row = first rank A..2, pairs on the diagonal, suited above it). */
export const ALL_HAND_CLASSES: string[] = (() => {
  const desc = [...RANKS].reverse();
  const out: string[] = [];
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      if (row === col) out.push(desc[row] + desc[col]);
      else if (col > row) out.push(desc[row] + desc[col] + 's');
      else out.push(desc[col] + desc[row] + 'o');
    }
  }
  return out;
})();
