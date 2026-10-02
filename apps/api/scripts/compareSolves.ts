// Scores one set of flop solves against another, flop by flop, using the reference solve's EVs.
// EV loss = what a hand gives up at a decision by playing the candidate strategy instead of the
// best action, valued with the reference solve's per-action EVs (needs solver output with `ev_bb`).
// Run from the repo root:
//   npx tsx apps/api/scripts/compareSolves.ts <reference dir> <candidate dir>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlopFile, FlopNode } from '../src/postflop/flopStore.js';

const [refDir, candDir] = process.argv.slice(2);
if (!refDir || !candDir) throw new Error('usage: compareSolves.ts <reference dir> <candidate dir>');

const flopsIn = (dir: string) => readdirSync(dir).filter((f) => /^([2-9TJQKA][cdhs]){3}\.json$/.test(f));
const read = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as FlopFile & { exploitability_pct_pot: number; seconds: number };
const shared = flopsIn(refDir).filter((f) => flopsIn(candDir).includes(f));
if (!shared.length) throw new Error('no flops in common');

/** Weighted EV loss (bb) and frequency difference of `cand` at one reference node, summed over hands. */
function nodeLoss(ref: FlopNode, cand: FlopNode) {
  if (!ref.ev_bb || !ref.weights) throw new Error('reference output has no ev_bb/weights; re-solve with the current solver');
  let loss = 0;
  let diff = 0;
  let weight = 0;
  ref.weights.forEach((w, h) => {
    if (w <= 0) return;
    const evs = ref.ev_bb!.map((row) => row[h]);
    const best = Math.max(...evs);
    const played = cand.strategy.reduce((s, row, a) => s + (row[h] / 1000) * evs[a], 0);
    loss += w * Math.max(0, best - played);
    diff += (w * cand.strategy.reduce((s, row, a) => s + Math.abs(row[h] - ref.strategy[a][h]), 0)) / 2000;
    weight += w;
  });
  return { loss, diff, weight };
}

let sumLoss = 0;
let sumSelf = 0;
let sumRootDiff = 0;
let sumTime = [0, 0];
console.log('flop    | EV loss bb/hand | ref own loss | root freq diff | time ref -> cand');
for (const f of shared) {
  const ref = read(refDir, f);
  const cand = read(candDir, f);
  const candNodes = new Map(cand.nodes.map((n) => [n.history.join('.'), n]));
  // A node's weights sum to the (joint) deals that reach it, the same for both players, so dividing
  // by the root's sum turns each node's loss into bb per flop dealt.
  const rootTotal = ref.nodes.find((n) => n.history.length === 0)!.weights!.reduce((a, b) => a + b, 0);
  const rootWeight = [rootTotal, rootTotal];
  let loss = 0;
  let self = 0;
  let rootDiff = 0;
  for (const node of ref.nodes) {
    const c = candNodes.get(node.history.join('.'));
    // Nodes missing from the candidate tree (e.g. a raise it can't make) are skipped.
    if (!c || c.actions.join() !== node.actions.join()) continue;
    const r = nodeLoss(node, c);
    loss += r.loss / rootWeight[node.player];
    self += nodeLoss(node, node).loss / rootWeight[node.player];
    if (node.history.length === 0) rootDiff = r.diff / r.weight;
  }
  sumLoss += loss;
  sumSelf += self;
  sumRootDiff += rootDiff;
  sumTime = [sumTime[0] + ref.seconds, sumTime[1] + cand.seconds];
  console.log(`${f.slice(0, 6)}  | ${loss.toFixed(3).padStart(15)} | ${self.toFixed(3).padStart(12)} | ${(rootDiff * 100).toFixed(1).padStart(13)}% | ${ref.seconds.toFixed(0)}s -> ${cand.seconds.toFixed(0)}s`);
}
const n = shared.length;
console.log(
  `\nmean over ${n} flops: EV loss ${(sumLoss / n).toFixed(3)} bb/hand (reference's own ${(sumSelf / n).toFixed(3)}), root frequency diff ${((sumRootDiff / n) * 100).toFixed(1)}%, time ${(sumTime[0] / n).toFixed(0)}s -> ${(sumTime[1] / n).toFixed(0)}s per flop`,
);
