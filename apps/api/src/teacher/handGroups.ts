import { rankIndex, suitOf } from '../poker/cards.js';
import { bestHand, compareScores } from '../poker/evaluator.js';

/**
 * Hand groups the coach talks about: classes before the flop, made hands and draws after it. The
 * coach gets each group's share of a range and its strategy (see spotSummary.ts), so it can explain
 * the whole spot rather than only hero's hand.
 */

export const PREFLOP_GROUPS = [
  'High pairs (TT+)',
  'Middle pairs (66-99)',
  'Low pairs (22-55)',
  'Suited aces',
  'Suited broadways',
  'Suited connectors and gappers',
  'Other suited',
  'Offsuit broadways',
  'Offsuit aces',
  'Other offsuit',
] as const;

export const POSTFLOP_GROUPS = [
  'Straight or better',
  'Sets and trips',
  'Two pair',
  'Overpairs',
  'Top pair, good kicker',
  'Top pair, weak kicker',
  'Middle pair',
  'Bottom pair',
  'Underpairs',
  'Combo draws',
  'Flush draws',
  'Open-ended straight draws',
  'Gutshots',
  'Overcards',
  'Air',
] as const;

const T = rankIndex('T');
const Q = rankIndex('Q');
const A = rankIndex('A');

/** The preflop group of a hand class like "AKs", "T9o" or "77". */
export function preflopGroup(hc: string): string {
  const hi = rankIndex(hc[0]);
  const lo = rankIndex(hc[1]);
  if (hc.length === 2) return hi >= T ? PREFLOP_GROUPS[0] : hi >= rankIndex('6') ? PREFLOP_GROUPS[1] : PREFLOP_GROUPS[2];
  if (hc[2] === 's') {
    if (hi === A) return 'Suited aces';
    if (lo >= T) return 'Suited broadways';
    if (hi - lo <= 2) return 'Suited connectors and gappers';
    return 'Other suited';
  }
  if (lo >= T) return 'Offsuit broadways';
  if (hi === A) return 'Offsuit aces';
  return 'Other offsuit';
}

/** Ranks that would complete a straight using at least one hole card (ace counts low too). */
function straightOuts(hole: number[], board: number[]): Set<number> {
  const has = new Set([...hole, ...board]);
  if (has.has(A)) has.add(-1);
  const holeSet = new Set(hole.flatMap((r) => (r === A ? [r, -1] : [r])));
  const outs = new Set<number>();
  for (let low = -1; low <= 8; low++) {
    const window = [0, 1, 2, 3, 4].map((i) => low + i);
    const missing = window.filter((r) => !has.has(r));
    if (missing.length === 1 && window.some((r) => holeSet.has(r))) outs.add(missing[0] === -1 ? A : missing[0]);
  }
  return outs;
}

function flushDraw(hole: string[], board: string[]): boolean {
  return hole.some((h) => [...hole, ...board].filter((c) => suitOf(c) === suitOf(h)).length === 4);
}

/**
 * The postflop group of two hole cards on a board (3 to 5 cards), and the draw it also has when
 * the group is a made hand ("flush draw", "straight draw"); no draws on the river.
 */
export function postflopGroup(hole: string[], board: string[]): { group: string; draw: string | null } {
  const boardRanks = board.map(rankIndex);
  const top = [...new Set(boardRanks)].sort((a, b) => b - a);
  const [h1, h2] = hole.map(rankIndex);
  const best = bestHand([...hole, ...board]);
  // A 5-card board can be the whole hand: then hero's cards add nothing.
  const playsBoard = board.length === 5 && compareScores(bestHand(board).score, best.score) === 0;

  const river = board.length === 5;
  const fd = !river && flushDraw(hole, board);
  const outs = river ? new Set<number>() : straightOuts([h1, h2], boardRanks);
  const sd = outs.size >= 2 ? 'open-ended straight draw' : outs.size === 1 ? 'gutshot' : null;
  const draw = fd && sd ? `flush draw and ${sd}` : fd ? 'flush draw' : sd;
  const made = (group: string) => ({ group, draw });

  if (!playsBoard && best.score[0] >= 4) return made('Straight or better');
  const count = (r: number) => boardRanks.filter((b) => b === r).length;
  if (h1 === h2) {
    if (count(h1) >= 1) return made('Sets and trips');
    return made(h1 > top[0] ? 'Overpairs' : 'Underpairs');
  }
  const paired = [h1, h2].filter((r) => count(r) >= 1);
  if (paired.some((r) => count(r) >= 2)) return made('Sets and trips');
  if (paired.length === 2) return made('Two pair');
  if (paired.length === 1) {
    const r = paired[0];
    const kicker = r === h1 ? h2 : h1;
    if (r === top[0]) return made(kicker >= Q && !top.includes(kicker) ? 'Top pair, good kicker' : 'Top pair, weak kicker');
    return made(r === top[1] ? 'Middle pair' : 'Bottom pair');
  }
  // Nothing made: the draw is the group.
  if (fd && sd) return { group: 'Combo draws', draw: null };
  if (fd) return { group: 'Flush draws', draw: null };
  if (sd === 'open-ended straight draw') return { group: 'Open-ended straight draws', draw: null };
  if (sd) return { group: 'Gutshots', draw: null };
  return { group: h1 > top[0] && h2 > top[0] ? 'Overcards' : 'Air', draw: null };
}
