// How much EV does playing a *mapped* flop strategy lose, compared with the real solve of that flop?
// For each held-out flop, builds the strategy the app would use (the nearest solved flop, or a blend
// of the k nearest) and values it with the held-out solve's own per-action EVs. Reports bb per hand
// and % of the pot, so it can be compared with the solver's exploitability target.
// Needs solver output with `ev_bb`/`weights` (the current tree).
// Run from the repo root:
//   npx tsx apps/api/scripts/flopEvLoss.ts [spot dir] [--train 50,100,184] [--k 1,3,5] [--test 300]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CardMapper, flopDistance, handIndex, mapHand, parseCards, shapeOf } from '../src/postflop/flopMap.js';
import type { FlopFile, FlopNode } from '../src/postflop/flopStore.js';

const argv = process.argv.slice(2);
const opt = (name: string, dflt: string) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const dir = argv.find((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--'))) ?? 'solver/output/btn_vs_bb_srp_100';
const trainSizes = opt('--train', '50,100,184,400').split(',').map(Number);
const ks = opt('--k', '1,3,5').split(',').map(Number);
const testCount = Number(opt('--test', '300'));

type File = FlopFile & { weight: number };
const all = readdirSync(dir)
  .filter((f) => /^([2-9TJQKA][cdhs]){3}\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as File)
  .filter((f) => f.nodes[0]?.ev_bb && f.nodes[0]?.weights);
if (all.length < 50) throw new Error(`${dir}: only ${all.length} flops with EVs`);

// Deterministic shuffle so train/test splits are random but repeatable.
let seed = 2024;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const shuffled = [...all].sort((a, b) => a.flop.localeCompare(b.flop));
for (let i = shuffled.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
}
const test = shuffled.slice(0, testCount);
const pool = shuffled.slice(testCount);
const potBb = (() => {
  const spot = JSON.parse(readFileSync(join(dir, '_spot.json'), 'utf8')) as { pot_bb: number };
  return spot.pot_bb;
})();

/** The k nearest same-shape flops, closest first. */
function nearest(flop: string, train: File[], k: number): { file: File; distance: number }[] {
  const target = shapeOf(parseCards(flop));
  return train
    .map((file) => ({ file, s: shapeOf(parseCards(file.flop)) }))
    .filter(({ s }) => s.pattern === target.pattern && s.pairing === target.pairing)
    .map(({ file, s }) => ({ file, distance: flopDistance(target, s) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);
}

/**
 * Strategy (permille rows per action) the app would play at `node` of the real flop, built from
 * the given neighbours: each hand is mapped onto each neighbour and their strategies are averaged,
 * closer flops weighing more.
 */
function blended(truth: File, node: FlopNode, neighbours: { file: File; distance: number }[]): number[][] | null {
  const key = node.history.join(',');
  const parts = neighbours
    .map(({ file, distance }) => {
      const other = file.nodes.find((n) => n.history.join(',') === key);
      if (!other || other.actions.join() !== node.actions.join()) return null;
      const mapper = new CardMapper(parseCards(truth.flop), parseCards(file.flop));
      const idx = handIndex(file.hands[node.player]);
      const map = truth.hands[node.player].map((h) => mapHand(parseCards(h), mapper, file.hands[node.player], idx));
      return { other, map, w: 1 / (1 + distance) };
    })
    .filter((x) => x !== null);
  if (!parts.length) return null;
  const total = parts.reduce((s, p) => s + p.w, 0);
  return node.strategy.map((_, a) =>
    truth.hands[node.player].map((_, h) => parts.reduce((s, p) => s + p.w * p.other.strategy[a][p.map[h]], 0) / total),
  );
}

/** Reach-weighted EV loss (bb) at one node, summed over hands, against the truth's best action. */
function nodeLoss(node: FlopNode, strategy: number[][]): number {
  let loss = 0;
  node.weights!.forEach((w, h) => {
    if (w <= 0) return;
    const evs = node.ev_bb!.map((row) => row[h]);
    const best = Math.max(...evs);
    const played = strategy.reduce((s, row, a) => s + (row[h] / 1000) * evs[a], 0);
    loss += w * Math.max(0, best - played);
  });
  return loss;
}

/** bb per hand lost on one flop (and the solve's own baseline), using the flop's own EVs. */
function flopLoss(truth: File, neighbours: { file: File; distance: number }[] | null) {
  const rootTotal = truth.nodes.find((n) => n.history.length === 0)!.weights!.reduce((a, b) => a + b, 0);
  let loss = 0;
  let own = 0;
  for (const node of truth.nodes) {
    own += nodeLoss(node, node.strategy) / rootTotal;
    if (neighbours) {
      const s = blended(truth, node, neighbours);
      // A node the neighbour tree lacks plays the truth (no loss counted): rare, same tree.
      loss += nodeLoss(node, s ?? node.strategy) / rootTotal;
    }
  }
  return { loss, own };
}

const pct = (bb: number) => `${((bb / potBb) * 100).toFixed(2)}%`;
console.log(`${dir}: ${all.length} flops with EVs; testing on ${test.length} held-out flops, pot ${potBb}bb\n`);
console.log('train flops | k | EV loss bb/hand | % of pot | solve\'s own | no same-shape match');
for (const n of trainSizes) {
  if (n > pool.length) continue;
  const train = pool.slice(0, n);
  for (const k of ks) {
    let loss = 0;
    let own = 0;
    let weight = 0;
    let missing = 0;
    for (const t of test) {
      const nb = nearest(t.flop, train, k);
      if (!nb.length) {
        missing++;
        continue;
      }
      const r = flopLoss(t, nb);
      // Weight each test flop by how often it comes up at the table.
      loss += r.loss * t.weight;
      own += r.own * t.weight;
      weight += t.weight;
    }
    console.log(
      `${String(n).padStart(11)} | ${k} | ${(loss / weight).toFixed(4).padStart(15)} | ${pct(loss / weight).padStart(8)} | ${pct(own / weight).padStart(11)} | ${missing}`,
    );
  }
}
