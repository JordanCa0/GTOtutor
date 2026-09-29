import { SIX_MAX_POSITIONS, type LegalAction, type Position } from '@gtotutor/shared-types';
import { ALL_HAND_CLASSES, RANKS, comboCount } from '../poker/cards.js';
import { makeNodeKey, type NodeType } from './nodeKeys.js';
import type { ChartNode, ChartSet } from './types.js';

/**
 * Phase 0 placeholder charts for 6-max / 100bb. Ranges come from a heuristic hand ordering
 * (Chen formula) cut at textbook-ish widths — NOT solver output, and no EVs. The CFR+ solver
 * replaces this module by producing a ChartSet with the same shape.
 */

const STACK = 100;
const TOTAL_COMBOS = 1326;

/** Open-raise widths. The SB also limps (SB_LIMP_PCT) instead of playing raise-or-fold. */
export const RFI_WIDTH_PCT: Record<Position, number> = { UTG: 15, HJ: 19, CO: 27, BTN: 44, SB: 24, BB: 0 };
export const SB_LIMP_PCT = 36;
export const ISO_RAISE_SIZE = 3.5;
const SB_VS_ISO_3BET_SIZE = 11;
export const openSize = (pos: Position) => (pos === 'SB' ? 3 : 2.5);
export const threeBetSize = (pos: Position) => (pos === 'SB' || pos === 'BB' ? 10 : 7.5);
export const FOUR_BET_SIZE = 22;

/** Postflop acting order: SB, BB, then UTG..BTN. */
const postflopIndex = (p: Position) => ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'].indexOf(p);
const isInPositionVs = (a: Position, b: Position) => postflopIndex(a) > postflopIndex(b);

function chenScore(hc: string): number {
  const value = (r: string) => ({ A: 10, K: 8, Q: 7, J: 6 } as Record<string, number>)[r] ?? (RANKS.indexOf(r) + 2) / 2;
  if (hc.length === 2) return Math.max(value(hc[0]) * 2, 5);
  let score = value(hc[0]);
  if (hc[2] === 's') score += 2;
  const gap = RANKS.indexOf(hc[0]) - RANKS.indexOf(hc[1]) - 1;
  score -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && RANKS.indexOf(hc[0]) < RANKS.indexOf('Q')) score += 1;
  return score;
}

const typeOrder = (hc: string) => (hc.length === 2 ? 0 : hc[2] === 's' ? 1 : 2);

export const STRENGTH_ORDER: string[] = [...ALL_HAND_CLASSES].sort(
  (a, b) =>
    chenScore(b) - chenScore(a) ||
    typeOrder(a) - typeOrder(b) ||
    RANKS.indexOf(b[0]) - RANKS.indexOf(a[0]) ||
    RANKS.indexOf(b[1]) - RANKS.indexOf(a[1]),
);

/** Percentile (0-100) of each class's midpoint in the strength ordering, by combos. */
const MIDPOINT_PCT: Map<string, number> = (() => {
  const out = new Map<string, number>();
  let cum = 0;
  for (const hc of STRENGTH_ORDER) {
    const c = comboCount(hc);
    out.set(hc, ((cum + c / 2) / TOTAL_COMBOS) * 100);
    cum += c;
  }
  return out;
})();

/** Share of a hand inside the top `pct`% — a soft edge so boundary hands get mixed strategies. */
function insideShare(pct: number, mid: number): number {
  if (pct <= 0) return 0;
  const band = Math.min(1.5, pct * 0.25);
  return Math.min(1, Math.max(0, (pct + band - mid) / (2 * band)));
}

const round2 = (x: number) => Math.round(x * 100) / 100;

interface Mix {
  fold: number;
  call: number;
  agg: number;
}

function buildMixes(aggPct: number, callPct: number, bluffs: Record<string, number> = {}): Map<string, Mix> {
  const out = new Map<string, Mix>();
  for (const hc of ALL_HAND_CLASSES) {
    const mid = MIDPOINT_PCT.get(hc)!;
    let agg = insideShare(aggPct, mid);
    let call = Math.max(0, insideShare(aggPct + callPct, mid) - agg);
    // Bluff-raise candidates take their raising share from both calls and folds.
    const bluff = bluffs[hc] ?? 0;
    const moved = (1 - agg) * bluff;
    call -= call * bluff;
    agg += moved;
    const a = round2(agg);
    const c = round2(call);
    out.set(hc, { agg: a, call: c, fold: round2(Math.max(0, 1 - a - c)) });
  }
  return out;
}

const act = (id: LegalAction['id'], label: string, toBb: number | null): LegalAction => ({ id, label, toBb });

function makeNode(
  type: NodeType,
  pos: Position,
  vs: Position | undefined,
  label: string,
  actions: LegalAction[],
  mixes: Map<string, Mix>,
): ChartNode {
  const strategy = new Map<string, number[]>();
  const ev = new Map<string, (number | null)[]>();
  for (const [hc, m] of mixes) {
    strategy.set(
      hc,
      // In check/raise spots the passive remainder of the range checks instead of folding.
      actions.map((a) => (a.id === 'fold' || a.id === 'check' ? m.fold : a.id === 'call' ? m.call : m.agg)),
    );
    ev.set(hc, actions.map(() => null));
  }
  return { nodeKey: makeNodeKey('SIX_MAX', STACK, type, pos, vs), label, actions, strategy, ev };
}

const WHEEL_ACE_BLUFFS_3BET = { A5s: 0.6, A4s: 0.5, A3s: 0.3 };
const WHEEL_ACE_BLUFFS_4BET = { A5s: 0.35, A4s: 0.2 };

export function buildFixtureChartSet(): ChartSet {
  const nodes = new Map<string, ChartNode>();
  const add = (n: ChartNode) => nodes.set(n.nodeKey, n);
  const others = (p: Position) => SIX_MAX_POSITIONS.filter((q) => q !== p);

  for (const pos of SIX_MAX_POSITIONS) {
    if (pos === 'SB') {
      add(
        makeNode('RFI', pos, undefined, 'SB first in (raise, limp, or fold)', [act('fold', 'Fold', null), act('call', 'Limp', null), act('raise', `Raise to ${openSize(pos)}`, openSize(pos))], buildMixes(RFI_WIDTH_PCT.SB, SB_LIMP_PCT)),
      );
    } else if (pos !== 'BB') {
      add(
        makeNode('RFI', pos, undefined, `${pos} first in (open-raise or fold)`, [act('fold', 'Fold', null), act('raise', `Raise to ${openSize(pos)}`, openSize(pos))], buildMixes(RFI_WIDTH_PCT[pos], 0)),
      );
    }

    for (const vs of others(pos)) {
      const w = RFI_WIDTH_PCT[vs] || 20;
      const [agg3, call3] =
        pos === 'BB' ? [w * 0.22, Math.min(w * 1.1, 45)] : pos === 'SB' ? [w * 0.3, w * 0.08] : [w * 0.2, pos === 'BTN' ? w * 0.35 : w * 0.18];
      add(
        makeNode('VS_OPEN', pos, vs, `${pos} facing ${vs} open`, [act('fold', 'Fold', null), act('call', 'Call', null), act('raise', `3-bet to ${threeBetSize(pos)}`, threeBetSize(pos))], buildMixes(agg3, call3, WHEEL_ACE_BLUFFS_3BET)),
      );

      const ip = isInPositionVs(pos, vs);
      add(
        makeNode('VS_3BET', pos, vs, `${pos} (opener) facing ${vs} 3-bet`, [act('fold', 'Fold', null), act('call', 'Call', null), act('raise', `4-bet to ${FOUR_BET_SIZE}`, FOUR_BET_SIZE)], buildMixes(Math.max(2.2, (RFI_WIDTH_PCT[pos] || 20) * 0.1), (RFI_WIDTH_PCT[pos] || 20) * (ip ? 0.3 : 0.18), WHEEL_ACE_BLUFFS_4BET)),
      );
      add(
        makeNode('VS_4BET', pos, vs, `${pos} (3-bettor) facing ${vs} 4-bet`, [act('fold', 'Fold', null), act('call', 'Call', null), act('allin', `All-in ${STACK}`, STACK)], buildMixes(1.8, ip ? 1.8 : 0.9)),
      );
      add(makeNode('VS_5BET', pos, vs, `${pos} (4-bettor) facing ${vs} all-in`, [act('fold', 'Fold', null), act('call', 'Call all-in', null)], buildMixes(0, 2.6)));
    }

    const isCold = (label: string) => `${pos} cold, facing a ${label}`;
    add(makeNode('COLD_VS_3BET', pos, undefined, isCold('3-bet'), [act('fold', 'Fold', null), act('call', 'Call', null), act('raise', `4-bet to ${FOUR_BET_SIZE}`, FOUR_BET_SIZE)], buildMixes(0.5, 0.9)));
    add(makeNode('COLD_VS_4BET', pos, undefined, isCold('4-bet'), [act('fold', 'Fold', null), act('call', 'Call', null), act('allin', `All-in ${STACK}`, STACK)], buildMixes(0.45, 0)));
    add(makeNode('COLD_VS_5BET', pos, undefined, isCold('5-bet all-in'), [act('fold', 'Fold', null), act('call', 'Call all-in', null)], buildMixes(0, 0.9)));
  }

  // Limped pots: only the SB can limp, so these are always SB vs BB.
  add(makeNode('VS_LIMP', 'BB', 'SB', 'BB facing SB limp', [act('check', 'Check', null), act('raise', `Raise to ${ISO_RAISE_SIZE}`, ISO_RAISE_SIZE)], buildMixes(28, 0, WHEEL_ACE_BLUFFS_3BET)));
  add(
    makeNode('VS_ISO', 'SB', 'BB', 'SB (limped) facing BB raise', [act('fold', 'Fold', null), act('call', 'Call', null), act('raise', `3-bet to ${SB_VS_ISO_3BET_SIZE}`, SB_VS_ISO_3BET_SIZE)], buildMixes(4, 24)),
  );

  return {
    version: 'fixture-v2',
    dataSource: {
      kind: 'fixture',
      note: 'Placeholder ranges from a heuristic hand ranking at approximate standard widths — not solver output yet. EVs are unavailable until the CFR+ solver lands.',
    },
    nodes,
  };
}
