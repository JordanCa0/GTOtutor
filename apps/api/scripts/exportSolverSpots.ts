// Writes solver/spots/*.json from the current preflop charts: the ranges that reach each flop.
// Run from the repo root: npx tsx apps/api/scripts/exportSolverSpots.ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';

const charts = buildFixtureChartSet();

/** "AKs,AQs:0.500,…" in postflop-solver's range format: the share of each class taking `action`. */
function range(nodeKey: string, action: string): string {
  const node = charts.nodes.get(nodeKey);
  if (!node) throw new Error(`no chart node ${nodeKey}`);
  const i = node.actions.findIndex((a) => a.id === action);
  return [...node.strategy]
    .filter(([, f]) => f[i] > 0.001)
    .map(([hc, f]) => (f[i] >= 0.999 ? hc : `${hc}:${f[i].toFixed(3)}`))
    .join(',');
}

const spots = [
  {
    name: 'btn_vs_bb_srp_100',
    description: `BTN opens 2.5, BB calls; 100bb. Ranges from charts ${charts.version}.`,
    chips_per_bb: 20,
    pot_bb: 5.5,
    stack_bb: 97.5,
    oop_range: range('SIX_MAX|100|VS_OPEN|BB|BTN', 'call'),
    ip_range: range('SIX_MAX|100|RFI|BTN', 'raise'),
    // Deliberately small tree (one size per street) to keep each solve cheap.
    flop: ['33%', '3x'],
    turn: ['66%', '3x'],
    river: ['75%', '3x'],
  },
];

mkdirSync('solver/spots', { recursive: true });
for (const spot of spots) {
  writeFileSync(`solver/spots/${spot.name}.json`, `${JSON.stringify(spot, null, 2)}\n`);
  console.log(`wrote solver/spots/${spot.name}.json`);
}
