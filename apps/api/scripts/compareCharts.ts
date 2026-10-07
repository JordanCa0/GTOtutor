// How different are two preflop chart versions? Per node: the combo-weighted share of the range
// whose action changes (half the summed frequency difference). Used to tell when calibration
// rounds have settled.
// Run from the repo root: npx tsx apps/api/scripts/compareCharts.ts <a.json> <b.json>
import { readFileSync } from 'node:fs';
import { loadSolvedCharts } from '../src/charts/solvedCharts.js';
import { ALL_HAND_CLASSES, comboCount } from '../src/poker/cards.js';

const [aPath, bPath] = process.argv.slice(2);
if (!aPath || !bPath) throw new Error('usage: compareCharts.ts <a.json> <b.json>');
const a = loadSolvedCharts(aPath);
const b = loadSolvedCharts(bPath);

// Newer chart files carry, per node and class, the chance of reaching that node with that class.
// With it, changes are also weighted by how often they'd come up at the table.
type RawFile = { nodes: { nodeKey: string; reach?: Record<string, number> }[] };
const reach = new Map(
  (JSON.parse(readFileSync(bPath, 'utf8')) as RawFile).nodes.filter((n) => n.reach).map((n) => [n.nodeKey, n.reach!]),
);
let playedDiff = 0;
let playedWeight = 0;

const rows: { key: string; diff: number; shares: string }[] = [];
for (const [key, na] of a.nodes) {
  const nb = b.nodes.get(key);
  if (!nb || na.actions.length !== nb.actions.length) continue;
  let diff = 0;
  const share = [na, nb].map(() => na.actions.map(() => 0));
  for (const hc of ALL_HAND_CLASSES) {
    const c = comboCount(hc) / 1326;
    const fa = na.strategy.get(hc)!;
    const fb = nb.strategy.get(hc)!;
    const r = reach.get(key)?.[hc];
    if (r !== undefined) {
      playedDiff += (c * r * fa.reduce((s, x, i) => s + Math.abs(x - fb[i]), 0)) / 2;
      playedWeight += c * r;
    }
    fa.forEach((x, i) => {
      diff += (c * Math.abs(x - fb[i])) / 2;
      share[0][i] += c * x;
      share[1][i] += c * fb[i];
    });
  }
  const fmt = (s: number[]) => s.map((x, i) => `${na.actions[i].id} ${(x * 100).toFixed(0)}%`).join(' ');
  rows.push({ key, diff, shares: `${fmt(share[0])}  ->  ${fmt(share[1])}` });
}
// Unreached placeholder nodes are identical in both files; leave them out of the average.
const changed = rows.filter((r) => r.diff > 0);
const mean = changed.reduce((s, r) => s + r.diff, 0) / Math.max(1, changed.length);
console.log(`${a.version} -> ${b.version}: ${changed.length} nodes compared, mean ${(mean * 100).toFixed(1)}% of the range changes action`);
if (playedWeight > 0) console.log(`weighted by how often each node and hand comes up: ${((playedDiff / playedWeight) * 100).toFixed(1)}% of decisions change`);
console.log('');
for (const r of changed.sort((x, y) => y.diff - x.diff).slice(0, 12)) {
  console.log(`${(r.diff * 100).toFixed(1).padStart(5)}%  ${r.key.replace('SIX_MAX|100|', '').padEnd(22)} ${r.shares}`);
}
const rfi = rows.filter((r) => r.key.includes('|RFI|'));
console.log('\nopens:');
for (const r of rfi) console.log(`  ${r.key.replace('SIX_MAX|100|', '').padEnd(10)} ${r.shares}`);
