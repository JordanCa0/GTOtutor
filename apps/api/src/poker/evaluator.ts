import { rankIndex, suitOf } from './cards.js';

export const CATEGORY_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

/** Score is [category, ...tiebreak ranks]; compare lexicographically. */
export type HandScore = number[];

export function evaluate5(cards: string[]): HandScore {
  const ranks = cards.map(rankIndex).sort((a, b) => b - a);
  const isFlush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const unique = [...new Set(ranks)];
  let straightHigh = -1;
  if (unique.length === 5) {
    if (unique[0] - unique[4] === 4) straightHigh = unique[0];
    else if (unique.join() === '12,3,2,1,0') straightHigh = 3;
  }
  if (straightHigh >= 0) return [isFlush ? 8 : 4, straightHigh];
  if (isFlush) return [5, ...ranks];

  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  const category =
    shape === '41' ? 7 : shape === '32' ? 6 : shape === '311' ? 3 : shape === '221' ? 2 : shape === '2111' ? 1 : 0;
  return [category, ...groups.map((g) => g[0])];
}

export function compareScores(a: HandScore, b: HandScore): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1);
    if (d !== 0) return d;
  }
  return 0;
}

export function bestHand(sevenCards: string[]): { score: HandScore; name: string } {
  let best: HandScore | null = null;
  const n = sevenCards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) {
            const s = evaluate5([sevenCards[a], sevenCards[b], sevenCards[c], sevenCards[d], sevenCards[e]]);
            if (!best || compareScores(s, best) > 0) best = s;
          }
  return { score: best!, name: CATEGORY_NAMES[best![0]] };
}
