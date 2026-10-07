// Picks which flops to solve for a spot that won't get every flop (tier C in the solving plan).
// Greedy coverage: every suit/pairing shape gets flops in proportion to how often it's dealt, and
// within a shape each new flop is the one farthest from those already picked (weighted by how often
// it comes up), so textures are spread out instead of clustered.
// Writes one flop per line, for `gtotutor-solver --flops <file>`.
// Run from the repo root: npx tsx apps/api/scripts/pickFlops.ts <count> <out.txt> [--exclude <solved dir>]
import { readdirSync, writeFileSync } from 'node:fs';
import { flopDistance, parseCards, shapeOf } from '../src/postflop/flopMap.js';

const [countArg, outPath] = process.argv.slice(2);
const count = Number(countArg);
if (!count || !outPath) throw new Error('usage: pickFlops.ts <count> <out.txt> [--exclude <solved dir>]');
const exIdx = process.argv.indexOf('--exclude');
const already = new Set(
  exIdx >= 0
    ? readdirSync(process.argv[exIdx + 1])
        .filter((f) => /^([2-9TJQKA][cdhs]){3}\.json$/.test(f))
        .map((f) => f.slice(0, 6))
    : [],
);

// The 1,755 canonical flops with their weights, named the way the solver names them
// (cards high to low, suits assigned s, h, d, c in order of first appearance).
const RANKS = '23456789TJQKA';
const SUITS = 'shdc';
const flops = new Map<string, number>();
for (let a = 0; a < 52; a++)
  for (let b = a + 1; b < 52; b++)
    for (let c = b + 1; c < 52; c++) {
      const cards = [a, b, c].map((x) => ({ r: Math.floor(x / 4), s: x % 4 })).sort((x, y) => y.r - x.r || x.s - y.s);
      // Canonical suit relabelling: try every order of equal ranks so the name is unique.
      const orders = cards[0].r === cards[1].r || cards[1].r === cards[2].r ? permutations(cards) : [cards];
      let best = '';
      for (const o of orders) {
        if (!(o[0].r >= o[1].r && o[1].r >= o[2].r)) continue;
        const map = new Map<number, string>();
        const name = o.map((x) => {
          if (!map.has(x.s)) map.set(x.s, SUITS[map.size]);
          return RANKS[x.r] + map.get(x.s);
        });
        const n = name.join('');
        if (!best || n > best) best = n;
      }
      flops.set(best, (flops.get(best) ?? 0) + 1);
    }

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

const byShape = new Map<string, { flop: string; weight: number }[]>();
for (const [flop, weight] of flops) {
  const s = shapeOf(parseCards(flop));
  const key = `${s.pattern}|${s.pairing}`;
  byShape.set(key, [...(byShape.get(key) ?? []), { flop, weight }]);
}
const total = [...flops.values()].reduce((a, b) => a + b, 0);

const picked: string[] = [];
for (const [, list] of byShape) {
  const shapeWeight = list.reduce((s, f) => s + f.weight, 0);
  const quota = Math.max(1, Math.round((count * shapeWeight) / total));
  const chosen = list.filter((f) => already.has(f.flop));
  const shapes = new Map(list.map((f) => [f.flop, shapeOf(parseCards(f.flop))]));
  while (chosen.length < Math.min(quota + chosen.filter((f) => already.has(f.flop)).length, list.length)) {
    let best: { flop: string; weight: number } | null = null;
    let bestScore = -1;
    for (const f of list) {
      if (chosen.includes(f)) continue;
      const d = chosen.length ? Math.min(...chosen.map((c) => flopDistance(shapes.get(f.flop)!, shapes.get(c.flop)!))) : 100;
      const score = d * f.weight;
      if (score > bestScore) {
        bestScore = score;
        best = f;
      }
    }
    if (!best) break;
    chosen.push(best);
    picked.push(best.flop);
  }
}
writeFileSync(outPath, `${picked.join('\n')}\n`);
console.log(`picked ${picked.length} new flops across ${byShape.size} shapes (${already.size} already solved) -> ${outPath}`);
