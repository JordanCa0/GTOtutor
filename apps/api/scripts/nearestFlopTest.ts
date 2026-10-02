// How well does "use the nearest solved flop" predict flops we didn't solve?
// Trains on the first N flops a spot solved (solve order = file time) and tests on the rest.
// Run from the repo root: npx tsx apps/api/scripts/nearestFlopTest.ts [spot]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CardMapper, handIndex, mapHand, nearestFlop, parseCards, shapeOf } from '../src/postflop/flopMap.js';

interface Node {
  history: number[];
  player: number;
  strategy: number[][];
}
interface FlopFile {
  flop: string;
  weight: number;
  hands: [string[], string[]];
  nodes: Node[];
}

const spot = process.argv[2] ?? 'btn_vs_bb_srp_100';
const dir = join('solver/output', spot);
const files = readdirSync(dir)
  .filter((f) => /^[^_].*\.json$/.test(f))
  .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
  .sort((a, b) => a.t - b.t)
  .map(({ f }) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as FlopFile);
const byName = new Map(files.map((x) => [x.flop, x]));

const TEST_FROM = 184;
const test = files.slice(TEST_FROM);
console.log(`${spot}: ${files.length} solved flops; testing on ${test.length} (solve order ${TEST_FROM + 1}+)\n`);

/** Mean share of each hand's strategy that differs from the truth (0 = identical, 1 = disjoint). */
function compare(truth: FlopFile, from: FlopFile): { root: number; all: number } {
  const mapper = new CardMapper(parseCards(truth.flop), parseCards(from.flop));
  const indexes = [handIndex(from.hands[0]), handIndex(from.hands[1])];
  const mapped = [0, 1].map((p) => truth.hands[p].map((h) => mapHand(parseCards(h), mapper, from.hands[p], indexes[p])));
  const fromNodes = new Map(from.nodes.map((n) => [n.history.join(','), n]));
  let root = 0;
  let sum = 0;
  let count = 0;
  for (const node of truth.nodes) {
    const other = fromNodes.get(node.history.join(','));
    if (!other) continue;
    let nodeSum = 0;
    const hands = truth.hands[node.player];
    for (let h = 0; h < hands.length; h++) {
      const j = mapped[node.player][h];
      let diff = 0;
      for (let a = 0; a < node.strategy.length; a++) diff += Math.abs(node.strategy[a][h] - other.strategy[a][j]);
      nodeSum += diff / 2000;
    }
    const avg = nodeSum / hands.length;
    if (node.history.length === 0) root = avg;
    sum += avg;
    count++;
  }
  return { root, all: sum / count };
}

const rand = (() => {
  let s = 12345;
  return () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
})();

function evaluate(train: FlopFile[], pick: 'nearest' | 'random') {
  const names = train.map((x) => x.flop);
  let rootSum = 0;
  let allSum = 0;
  let weightSum = 0;
  let missing = 0;
  for (const t of test) {
    let match: string | undefined;
    if (pick === 'nearest') match = nearestFlop(parseCards(t.flop), names)?.flop;
    else {
      const shape = shapeOf(parseCards(t.flop));
      const same = names.filter((n) => {
        const s = shapeOf(parseCards(n));
        return s.pattern === shape.pattern && s.pairing === shape.pairing;
      });
      match = same[Math.floor(rand() * same.length)];
    }
    if (!match) {
      missing++;
      continue;
    }
    const r = compare(t, byName.get(match)!);
    // Weight each test flop by how often it comes up at the table.
    rootSum += r.root * t.weight;
    allSum += r.all * t.weight;
    weightSum += t.weight;
  }
  const pct = (x: number) => `${((x / weightSum) * 100).toFixed(1)}%`;
  return { root: pct(rootSum), all: pct(allSum), missing };
}

console.log('training flops | method            | first decision | all flop decisions | test flops with no same-shape match');
for (const n of [25, 50, 100, 184]) {
  const train = files.slice(0, n);
  for (const pick of ['nearest', 'random'] as const) {
    const r = evaluate(train, pick);
    console.log(`${String(n).padStart(14)} | ${(pick === 'nearest' ? 'nearest flop' : 'random same-shape').padEnd(17)} | ${r.root.padStart(14)} | ${r.all.padStart(18)} | ${r.missing}`);
  }
}
console.log('\nNumbers are the average share of a hand\'s strategy that differs from the real solve (weighted by flop frequency).');
