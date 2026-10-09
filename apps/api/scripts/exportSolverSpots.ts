// Writes solver spot files from the preflop charts: the ranges that reach each flop.
// Run from the repo root:
//   npx tsx apps/api/scripts/exportSolverSpots.ts                       placeholder charts -> solver/spots/
//   npx tsx apps/api/scripts/exportSolverSpots.ts --charts <file.json>  solved charts -> solver/spots/<version>/
import { mkdirSync, writeFileSync } from 'node:fs';
import { SIX_MAX_POSITIONS, type Position } from '@gtotutor/shared-types';
import { chartsFromEnv } from '../src/charts/solvedCharts.js';
import { FOUR_BET_SIZE, isoSize, openSize, SB_VS_ISO_3BET_SIZE, threeBetSize } from '../src/charts/fixtures.js';

const chartsArg = process.argv.indexOf('--charts');
const chartsPath = chartsArg >= 0 ? process.argv[chartsArg + 1] : undefined;
const charts = chartsFromEnv(chartsPath ?? '');
const outDir = chartsPath ? `solver/spots/${charts.version}` : 'solver/spots';
const STACK = 100;

/** One preflop decision a player made on the way to the flop: chart node + the action taken. */
type Step = [nodeKey: string, action: string];
const key = (type: string, pos: Position, vs?: Position) => ['SIX_MAX', STACK, type, pos, vs].filter((p) => p !== undefined).join('|');

/**
 * "AKs,AQs:0.500,…" in postflop-solver's range format: the share of each class that took every
 * step (frequencies multiply along the line).
 */
function range(...steps: Step[]): string {
  const share = new Map<string, number>();
  steps.forEach(([nodeKey, action], n) => {
    const node = charts.nodes.get(nodeKey);
    if (!node) throw new Error(`no chart node ${nodeKey}`);
    const i = node.actions.findIndex((a) => a.id === action);
    if (i < 0) throw new Error(`no action ${action} at ${nodeKey}`);
    for (const [hc, f] of node.strategy) share.set(hc, (n === 0 ? 1 : (share.get(hc) ?? 0)) * f[i]);
  });
  return [...share]
    .filter(([, f]) => f > 0.001)
    .map(([hc, f]) => (f >= 0.999 ? hc : `${hc}:${f.toFixed(3)}`))
    .join(',');
}

/** Postflop acting order: SB, BB, then UTG..BTN. */
const postflopIndex = (p: Position) => ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'].indexOf(p);
const deadBlinds = (a: Position, b: Position) => (a !== 'SB' && b !== 'SB' ? 0.5 : 0) + (a !== 'BB' && b !== 'BB' ? 1 : 0);
const lc = (p: Position) => p.toLowerCase();

interface Spot {
  name: string;
  description: string;
  chips_per_bb: number;
  pot_bb: number;
  stack_bb: number;
  oop_range: string;
  ip_range: string;
  flop: [string, string];
  turn: [string, string];
  river: [string, string];
}

/** Heads-up pot where each player put `invested` bb in preflop. */
function spot(name: string, description: string, a: Position, aRange: string, b: Position, bRange: string, invested: number): Spot {
  const aIsOop = postflopIndex(a) < postflopIndex(b);
  return {
    name,
    description: `${description}; ${STACK}bb. Ranges from charts ${charts.version}.`,
    chips_per_bb: 20,
    pot_bb: invested * 2 + deadBlinds(a, b),
    stack_bb: STACK - invested,
    oop_range: aIsOop ? aRange : bRange,
    ip_range: aIsOop ? bRange : aRange,
    // Deliberately small tree to keep each solve cheap: one size per street, and no raises on the
    // turn and river. Only the flop strategy is kept (the browser re-solves later streets), and
    // dropping those raises made solves 3x faster for ~0.005bb/hand of flop EV (docs/postflop-plan.md).
    flop: ['33%', '3x'],
    turn: ['66%', ''],
    river: ['75%', ''],
  };
}

const spots: Spot[] = [];
const order = SIX_MAX_POSITIONS; // preflop order: UTG, HJ, CO, BTN, SB, BB
for (const [i, opener] of order.entries()) {
  if (opener === 'BB') continue;
  const open: Step = [key('RFI', opener), 'raise'];
  for (const other of order.slice(i + 1)) {
    const o = lc(opener);
    const v = lc(other);
    // Single-raised pot: opener raises, `other` calls.
    spots.push(
      spot(`${o}_vs_${v}_srp_${STACK}`, `${opener} opens ${openSize(opener)}, ${other} calls`, opener, range(open), other, range([key('VS_OPEN', other, opener), 'call']), openSize(opener)),
    );
    // 3-bet pot: `other` 3-bets, opener calls.
    const tb = threeBetSize(other);
    const threeBet: Step = [key('VS_OPEN', other, opener), 'raise'];
    spots.push(
      spot(`${o}_vs_${v}_3bp_${STACK}`, `${opener} opens ${openSize(opener)}, ${other} 3-bets ${tb}, ${opener} calls`, opener, range(open, [key('VS_3BET', opener, other), 'call']), other, range(threeBet), tb),
    );
    // 4-bet pot: opener 4-bets, `other` calls.
    spots.push(
      spot(
        `${o}_vs_${v}_4bp_${STACK}`,
        `${opener} opens, ${other} 3-bets ${tb}, ${opener} 4-bets ${FOUR_BET_SIZE}, ${other} calls`,
        opener,
        range(open, [key('VS_3BET', opener, other), 'raise']),
        other,
        range(threeBet, [key('VS_4BET', other, opener), 'call']),
        FOUR_BET_SIZE,
      ),
    );
  }
}

// Limped pots: limper vs BB (checked behind), limper vs isolator, and limp-re-raised. Charts before
// v9 only let the SB limp; spots their charts can't reach are skipped (see `limpSpot`).
for (const [i, limper] of order.entries()) {
  if (limper === 'BB') continue;
  const limp: Step = [key('RFI', limper), 'call'];
  const l = lc(limper);
  limpSpot(() => spot(`${l}_vs_bb_limp_${STACK}`, `${limper} limps, BB checks`, limper, range(limp), 'BB', range([key('VS_LIMP', 'BB', limper), 'check']), 1));
  for (const iso of order.slice(i + 1)) {
    const size = isoSize(iso, limper);
    const isoStep: Step = [key('VS_LIMP', iso, limper), 'raise'];
    const v = lc(iso);
    limpSpot(() =>
      spot(`${l}_vs_${v}_iso_${STACK}`, `${limper} limps, ${iso} raises ${size}, ${limper} calls`, limper, range(limp, [key('VS_ISO', limper, iso), 'call']), iso, range(isoStep), size),
    );
    limpSpot(() =>
      spot(
        `${l}_vs_${v}_l3b_${STACK}`,
        `${limper} limps, ${iso} raises ${size}, ${limper} 3-bets ${SB_VS_ISO_3BET_SIZE}, ${iso} calls`,
        limper,
        range(limp, [key('VS_ISO', limper, iso), 'raise']),
        iso,
        range(isoStep, [key('VS_3BET', iso, limper), 'call']),
        SB_VS_ISO_3BET_SIZE,
      ),
    );
  }
}

/** Adds a limped-pot spot, unless the charts have no such line (a limp option or node they lack). */
function limpSpot(make: () => Spot): void {
  try {
    spots.push(make());
  } catch (err) {
    if (!/^no (chart node|action)/.test((err as Error).message)) throw err;
  }
}

mkdirSync(outDir, { recursive: true });
// A line the charts never take (e.g. SB limp-3bets with the placeholder charts) has an empty range.
const playable = spots.filter((s) => s.oop_range && s.ip_range);
for (const s of playable) writeFileSync(`${outDir}/${s.name}.json`, `${JSON.stringify(s, null, 2)}\n`);
const skipped = spots.filter((s) => !playable.includes(s)).map((s) => s.name);
console.log(`wrote ${playable.length} spots to ${outDir}/${skipped.length ? ` (skipped, empty range: ${skipped.join(', ')})` : ''}`);
