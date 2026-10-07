// How often each heads-up flop spot comes up when every seat plays the charts. Used to decide which
// spots get every flop solved (the most-played ones) and which get a sample.
// Run from the repo root: npx tsx apps/api/scripts/spotFrequency.ts [charts.json] [hands]
import type { ActionType, HandView } from '@gtotutor/shared-types';
import { ChartService } from '../src/charts/chartService.js';
import { chartsFromEnv } from '../src/charts/solvedCharts.js';
import { HandEngine } from '../src/engine/handEngine.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { handClass } from '../src/poker/cards.js';
import { seededRng } from '../src/poker/rng.js';

const [chartsPath, handsArg] = process.argv.slice(2);
const charts = new ChartService(chartsFromEnv(chartsPath ?? ''));
const engine = new HandEngine(charts, seededRng(1), runoutResolver);
const rng = seededRng(2);
const hands = Number(handsArg) || 200_000;

const POSITIONS = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
const order = (p: string) => ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'].indexOf(p);
const counts = new Map<string, number>();
let flops = 0;
let multiway = 0;

/** The heads-up spot name for a hand that reached the flop, like the files in solver/spots. */
function spotOf(view: HandView): string | null {
  const pre = view.actionLog.filter((a) => a.street === 'preflop');
  const live = view.seats.filter((s) => !pre.some((a) => a.position === s.position && a.action === 'fold')).map((s) => s.position);
  if (live.length !== 2) return null;
  const raises = pre.filter((a) => a.action === 'raise' || a.action === 'allin');
  const limped = pre.some((a) => a.action === 'call' && a.toBb === 1);
  if (limped) return `sb_vs_bb_${['limp', 'iso', 'l3b'][raises.length] ?? 'other'}_100`;
  const opener = raises[0]?.position;
  if (!opener) return null;
  const other = live.find((p) => p !== opener)!;
  const kind = raises.length === 1 ? 'srp' : raises.length === 2 ? '3bp' : raises.length === 3 ? '4bp' : 'allin';
  return `${opener.toLowerCase()}_vs_${other.toLowerCase()}_${kind}_100`;
}

for (let i = 0; i < hands; i++) {
  const state = engine.start({ tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: POSITIONS[rng.int(6)] as never });
  let view = engine.view(state);
  // Hero plays the charts too: sample its action from the chart strategy for its hand.
  while (view.status === 'awaiting_hero') {
    const spot = view.pendingSpot;
    const node = spot && charts.hasNode(spot.nodeKey) ? charts.getNode(spot.nodeKey) : null;
    let action: ActionType;
    if (node) {
      const hero = view.seats.find((s) => s.isHero)!;
      const freqs = node.strategy.get(handClass(hero.cards![0], hero.cards![1]))!;
      let roll = rng.float() * freqs.reduce((a, b) => a + b, 0);
      let k = 0;
      while (k < freqs.length - 1 && (roll -= freqs[k]) >= 0) k++;
      action = node.actions[k].id as ActionType;
    } else {
      // Flop decisions: any legal action; only the preflop line matters here.
      action = view.legalActions[0].id as ActionType;
    }
    engine.decide(state, action);
    view = engine.view(state);
  }
  if ((view.result?.board.length ?? 0) >= 3 || view.actionLog.some((a) => a.street === 'flop')) {
    flops++;
    const s = spotOf(view);
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
    else multiway++;
  }
}

const sorted = [...counts].sort((a, b) => b[1] - a[1]);
let cum = 0;
console.log(`${charts.dataSource.kind} charts: ${hands} hands, ${flops} reached a flop (${multiway} multiway or other)\n`);
console.log('spot                    share of flops  cumulative');
for (const [s, c] of sorted) {
  cum += c;
  console.log(`${s.padEnd(22)} ${((c / flops) * 100).toFixed(1).padStart(8)}%  ${((cum / flops) * 100).toFixed(1).padStart(8)}%`);
}
void order;
