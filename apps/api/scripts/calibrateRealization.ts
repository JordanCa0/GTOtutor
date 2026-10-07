// Measures equity realization from flop solver output, for the preflop solver's model:
//   realization = f(q) × g(class)
// - q: where the class ranks inside its own range by equity against the opponent's range
//   (0 = weakest, 1 = strongest). f is a curve per "<pot type>|<side>_<role>" (e.g.
//   "srp|oop_caller"; the role is who made the last preflop raise).
// - g: a playability multiplier per class, shared by every spot.
// A class's realization in a spot = its pot share (flop-root EV) / (pot × its equity), summed over
// the solved flops (weighted by how often each flop comes up) and its combos (by how much of each
// is in the range).
//
// Pass solves from several chart versions (calibration rounds) to average them: each version counts
// equally, and each spot counts equally within its version, however many flops it has. Averaging
// over rounds is what makes the calibration settle instead of swinging from round to round.
// Run from the repo root:
//   npx tsx apps/api/scripts/calibrateRealization.ts <out.json> solver/output/<version>/<spot> [...]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { FlopFile } from '../src/postflop/flopStore.js';

const [outPath, ...dirs] = process.argv.slice(2);
if (!outPath || !dirs.length) throw new Error('usage: calibrateRealization.ts <out.json> <spot dir> [<spot dir> ...]');

const BINS = 10; // must match preflop/src/realization.rs
const RANKS = '23456789TJQKA';
/** "AsKh" -> "AKo". */
function handClass(h: string): string {
  let [a, b] = [h.slice(0, 2), h.slice(2)];
  if (RANKS.indexOf(a[0]) < RANKS.indexOf(b[0])) [a, b] = [b, a];
  if (a[0] === b[0]) return a[0] + b[0];
  return a[0] + b[0] + (a[1] === b[1] ? 's' : 'o');
}

/** "AKs,AQs:0.5,…" -> class -> weight. */
function parseRange(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const part of s.split(',').filter(Boolean)) {
    const [hc, w] = part.split(':');
    m.set(hc, w === undefined ? 1 : Number(w));
  }
  return m;
}

/** Mid-rank of each item inside a weighted list, ordered by `value` (same as rank_in_range in Rust). */
function rankInRange(value: number[], weight: number[]): number[] {
  const total = weight.reduce((a, b) => a + b, 0);
  const order = value.map((_, i) => i).sort((a, b) => value[a] - value[b]);
  const q = new Array<number>(value.length).fill(0);
  let below = 0;
  for (let i = 0; i < order.length; ) {
    let j = i;
    let tied = 0;
    while (j < order.length && value[order[j]] === value[order[i]]) tied += weight[order[j++]] / total;
    for (let k = i; k < j; k++) q[order[k]] = below + tied / 2;
    below += tied;
    i = j;
  }
  return q;
}

/** Linear interpolation between curve points at (i + 0.5) / BINS (same as Rust). */
function interpolate(curve: number[], q: number): number {
  const x = Math.min(BINS - 1, Math.max(0, q * BINS - 0.5));
  const i = Math.min(BINS - 2, Math.floor(x));
  const t = x - i;
  return curve[i] * (1 - t) + curve[i + 1] * t;
}

/** One player's side of one spot in one chart version. */
interface Part {
  version: string;
  key: string;
  /** Per class: rank in range, pot share (EV) and pot × equity, normalised so shares sum to 1. */
  classes: { hc: string; q: number; ev: number; share: number }[];
  weight: number; // set below: equal weight per version, per spot within a version
}

const POT_TYPES = ['srp', '3bp', '4bp', 'limp', 'iso', 'l3b'];
const parts: Part[] = [];
const summary: string[] = [];

for (const dir of dirs) {
  if (!existsSync(join(dir, '_spot.json'))) {
    console.warn(`skipping ${dir}: no solves there`);
    continue;
  }
  const spot = JSON.parse(readFileSync(join(dir, '_spot.json'), 'utf8')) as { name: string; pot_bb: number; oop_range: string; ip_range: string };
  const potType = POT_TYPES.find((t) => spot.name.includes(`_${t}_`));
  if (!potType) throw new Error(`${dir}: can't tell the pot type from ${spot.name}`);
  const ranges = [parseRange(spot.oop_range), parseRange(spot.ip_range)];
  // Who made the last preflop raise, from the spot name ("<opener>_vs_<other>_<kind>_<stack>").
  const [opener, , other] = spot.name.split('_');
  const raiser = { srp: opener, '3bp': other, '4bp': opener, limp: null, iso: other, l3b: opener }[potType];
  const postflopOrder = ['sb', 'bb', 'utg', 'hj', 'co', 'btn'];
  const oop = postflopOrder.indexOf(opener) < postflopOrder.indexOf(other) ? opener : other;
  const roleOf = (p: number) => {
    const pos = p === 0 ? oop : oop === opener ? other : opener;
    return `${p === 0 ? 'oop' : 'ip'}_${pos === raiser ? 'raiser' : 'caller'}`;
  };

  // class -> [range weight, Σ w·EV, Σ w·pot·equity, Σ w·equity], per player
  const acc = [new Map<string, number[]>(), new Map<string, number[]>()];
  let used = 0;
  for (const f of readdirSync(dir).filter((f) => /^([2-9TJQKA][cdhs]){3}\.json$/.test(f))) {
    const flop = JSON.parse(readFileSync(join(dir, f), 'utf8')) as FlopFile & { weight: number; ev_bb: number[][]; equity: number[][] };
    if (!flop.ev_bb || !flop.equity) continue;
    used++;
    for (const p of [0, 1]) {
      flop.hands[p].forEach((h, i) => {
        const hc = handClass(h);
        const w = (ranges[p].get(hc) ?? 0) * (flop.weight || 1);
        if (w <= 0) return;
        const a = acc[p].get(hc) ?? [0, 0, 0, 0];
        a[0] += w;
        a[1] += w * flop.ev_bb[p][i];
        a[2] += w * spot.pot_bb * flop.equity[p][i];
        a[3] += w * flop.equity[p][i];
        acc[p].set(hc, a);
      });
    }
  }
  if (!used) {
    console.warn(`skipping ${dir}: no flops with ev_bb/equity`);
    continue;
  }
  const overall: string[] = [];
  for (const p of [0, 1]) {
    const entries = [...acc[p]];
    // Average flop equity against the opponent's range stands in for preflop equity (the same
    // thing on average), which is what the solver ranks by.
    const q = rankInRange(
      entries.map(([, a]) => a[3] / a[0]),
      entries.map(([, a]) => a[0]),
    );
    const totalShare = entries.reduce((s, [, a]) => s + a[2], 0);
    const totalEv = entries.reduce((s, [, a]) => s + a[1], 0);
    parts.push({
      version: basename(dirname(dir)),
      key: `${potType}|${roleOf(p)}`,
      classes: entries.map(([hc, a], i) => ({ hc, q: q[i], ev: a[1] / totalShare, share: a[2] / totalShare })),
      weight: 0,
    });
    overall.push(`${roleOf(p)} ${(totalEv / totalShare).toFixed(3)}`);
  }
  summary.push(`${basename(dirname(dir))}/${basename(dir)} (${used} flops): ${overall.join(', ')}`);
}

for (const part of parts) {
  const forKey = parts.filter((p) => p.key === part.key);
  const versions = new Set(forKey.map((p) => p.version)).size;
  part.weight = 1 / (forKey.filter((p) => p.version === part.version).length * versions);
}

// Alternate: curves given playability, then playability given curves.
const keys = [...new Set(parts.map((p) => p.key))].sort();
const play = new Map<string, number>();
const g = (hc: string) => play.get(hc) ?? 1;
let curves = new Map<string, number[]>();
for (let round = 0; round < 4; round++) {
  curves = new Map();
  for (const key of keys) {
    const ev = new Array<number>(BINS).fill(0);
    const share = new Array<number>(BINS).fill(0);
    for (const part of parts.filter((p) => p.key === key)) {
      for (const c of part.classes) {
        const bin = Math.min(BINS - 1, Math.floor(c.q * BINS));
        ev[bin] += part.weight * c.ev;
        share[bin] += part.weight * c.share * g(c.hc);
      }
    }
    const curve = ev.map((e, i) => (share[i] > 1e-9 ? Math.min(1.8, Math.max(0.2, e / share[i])) : NaN));
    // Empty bins (no hands at that rank) borrow from the nearest measured bin.
    for (let i = 0; i < BINS; i++) {
      if (!Number.isNaN(curve[i])) continue;
      for (let d = 1; d < BINS; d++) {
        const near = [curve[i - d], curve[i + d]].find((x) => x !== undefined && !Number.isNaN(x));
        if (near !== undefined) {
          curve[i] = near;
          break;
        }
      }
    }
    curves.set(key, curve);
  }
  // Playability: what's left of each class's realization once its rank is accounted for.
  const num = new Map<string, number>();
  const den = new Map<string, number>();
  for (const part of parts) {
    const curve = curves.get(part.key)!;
    for (const c of part.classes) {
      const expected = c.share * interpolate(curve, c.q);
      num.set(c.hc, (num.get(c.hc) ?? 0) + part.weight * c.ev);
      den.set(c.hc, (den.get(c.hc) ?? 0) + part.weight * expected);
    }
  }
  // Normalise to a share-weighted mean of 1 so the level stays in the curves.
  let wsum = 0;
  let gsum = 0;
  for (const [hc, d] of den) {
    const v = Math.min(1.4, Math.max(0.6, num.get(hc)! / d));
    play.set(hc, v);
    wsum += d;
    gsum += d * v;
  }
  for (const [hc, v] of play) play.set(hc, v / (gsum / wsum));
}

// Optional check of the model's assumption that playability is the same in every pot type:
// REPORT_CLASSES=65s,99,KQo prints each class's leftover realization per pot type.
const report = process.env.REPORT_CLASSES?.split(',').filter(Boolean) ?? [];
if (report.length) {
  console.log('\nleftover realization (after rank curve) by pot type:');
  const potTypes = [...new Set(parts.map((p) => p.key.split('|')[0]))].sort();
  console.log(`  ${'class'.padEnd(6)} ${potTypes.map((t) => t.padStart(6)).join(' ')}  overall`);
  for (const hc of report) {
    const cells = potTypes.map((t) => {
      let num = 0;
      let den = 0;
      for (const part of parts.filter((p) => p.key.startsWith(`${t}|`))) {
        const c = part.classes.find((x) => x.hc === hc);
        if (!c) continue;
        num += part.weight * c.ev;
        den += part.weight * c.share * interpolate(curves.get(part.key)!, c.q);
      }
      return den > 0 ? (num / den).toFixed(2).padStart(6) : '     -';
    });
    console.log(`  ${hc.padEnd(6)} ${cells.join(' ')}  ${g(hc).toFixed(2)}`);
  }
}

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const out = {
  curves: Object.fromEntries([...curves].map(([k, c]) => [k, c.map(round3)])),
  playability: Object.fromEntries([...play].sort().map(([hc, v]) => [hc, round3(v)])),
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(summary.join('\n'));
console.log('\ncurves (weakest -> strongest tenth of the range):');
for (const [k, c] of curves) {
  const versions = new Set(parts.filter((p) => p.key === k).map((p) => p.version)).size;
  console.log(`  ${k.padEnd(16)} ${c.map((x) => x.toFixed(2)).join(' ')}  (${versions} version(s))`);
}
const sortedPlay = [...play].sort((a, b) => a[1] - b[1]);
console.log(`\nplayability: lowest ${sortedPlay.slice(0, 5).map(([h, v]) => `${h} ${v.toFixed(2)}`).join(', ')}; highest ${sortedPlay.slice(-5).map(([h, v]) => `${h} ${v.toFixed(2)}`).join(', ')}`);
console.log(`wrote ${outPath}`);
