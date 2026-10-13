import { rankIndex, suitOf } from '../poker/cards.js';
import { bestHand, compareScores } from '../poker/evaluator.js';

const RANK_NAMES = ['twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces'];
const CARD_NAMES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'jack', 'queen', 'king', 'ace'];

/**
 * A plain-language read of a hand on a board, for JEV AI ("top pair, king kicker", "flush draw"):
 * Jev decides from a description, so the poker reading is done here.
 */
export function describeHand(hole: string[], board: string[]): { madeHand: string; draws: string[] } {
  return { madeHand: madeHand(hole, board), draws: board.length < 5 ? draws(hole, board) : [] };
}

function madeHand(hole: string[], board: string[]): string {
  const best = bestHand([...hole, ...board]);
  if (board.length === 5 && compareScores(bestHand(board).score, best.score) === 0) return `${best.name.toLowerCase()} on the board (the board plays; my cards add nothing)`;
  const boardRanks = board.map(rankIndex).sort((a, b) => b - a);
  const holeRanks = hole.map(rankIndex).sort((a, b) => b - a);
  const category = best.score[0];
  if (category >= 2) return best.name.toLowerCase();
  if (category === 0) {
    const over = holeRanks.filter((r) => r > boardRanks[0]).length;
    return over === 2 ? `no pair, two overcards (${CARD_NAMES[holeRanks[0]]} high)` : `no pair, ${CARD_NAMES[holeRanks[0]]} high`;
  }
  const pair = best.score[1];
  if (holeRanks[0] === holeRanks[1]) {
    if (pair !== holeRanks[0]) return `only the board's pair of ${RANK_NAMES[pair]}; my pocket ${RANK_NAMES[holeRanks[0]]} are below it`;
    return pair > boardRanks[0] ? `overpair (pocket ${RANK_NAMES[pair]})` : `pocket ${RANK_NAMES[pair]} below the top board card (underpair)`;
  }
  if (!holeRanks.includes(pair)) return `only the board's pair of ${RANK_NAMES[pair]}, ${CARD_NAMES[holeRanks[0]]} high`;
  const kicker = holeRanks.find((r) => r !== pair)!;
  const distinct = [...new Set(boardRanks)];
  const place = pair === distinct[0] ? 'top pair' : pair === distinct.at(-1) ? 'bottom pair' : 'middle pair';
  return `${place} (${RANK_NAMES[pair]}), ${CARD_NAMES[kicker]} kicker`;
}

function draws(hole: string[], board: string[]): string[] {
  const cards = [...hole, ...board];
  const out: string[] = [];
  const made = bestHand(cards).score[0];
  if (made < 5) {
    for (const s of 'shdc') {
      const n = cards.filter((c) => suitOf(c) === s).length;
      if (n === 4 && hole.some((c) => suitOf(c) === s)) out.push(hole.every((c) => suitOf(c) === s) ? 'flush draw (both my cards)' : 'flush draw');
    }
  }
  if (made < 4) {
    // Ranks that would make a straight using at least one of my cards. Ace plays low too (-1).
    const have = new Set(cards.flatMap((c) => (rankIndex(c) === 12 ? [12, -1] : [rankIndex(c)])));
    const mine = new Set(hole.flatMap((c) => (rankIndex(c) === 12 ? [12, -1] : [rankIndex(c)])));
    const outs = new Set<number>();
    for (let low = -1; low <= 8; low++) {
      const window = [0, 1, 2, 3, 4].map((k) => low + k);
      const missing = window.filter((r) => !have.has(r));
      if (missing.length === 1 && window.some((r) => mine.has(r) && r !== missing[0])) outs.add(missing[0] === -1 ? 12 : missing[0]);
    }
    if (outs.size >= 2) out.push('open-ended straight draw');
    else if (outs.size === 1) out.push(`gutshot straight draw (needs a ${CARD_NAMES[[...outs][0]]})`);
  }
  return out;
}
