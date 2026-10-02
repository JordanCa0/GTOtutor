import type { Position, ShowdownEntry } from '@gtotutor/shared-types';
import { bestHand, compareScores } from '../poker/evaluator.js';

export interface Contender {
  position: Position;
  cards: string[];
}

export interface ShowdownOutcome {
  board: string[];
  entries: ShowdownEntry[];
  winners: Position[];
}

/** Seam for Phase 2: a postflop engine with real betting can implement this same interface. */
export interface ShowdownResolver {
  /** `dealt` holds board cards already out (e.g. a flop that was played); the rest are dealt from the deck. */
  resolve(contenders: Contender[], remainingDeck: string[], dealt?: string[]): ShowdownOutcome;
}

/** MVP: no postflop betting — deal five board cards and compare best hands. */
export const runoutResolver: ShowdownResolver = {
  resolve(contenders, remainingDeck, dealt = []) {
    const board = [...dealt, ...remainingDeck.slice(0, 5 - dealt.length)];
    const evaluated = contenders.map((c) => ({ ...c, ...bestHand([...c.cards, ...board]) }));
    const top = evaluated.reduce((best, e) => (compareScores(e.score, best.score) > 0 ? e : best));
    const winners = evaluated.filter((e) => compareScores(e.score, top.score) === 0).map((e) => e.position);
    return {
      board,
      winners,
      entries: evaluated.map((e) => ({
        position: e.position,
        cards: e.cards,
        handName: e.name,
        isWinner: winners.includes(e.position),
      })),
    };
  },
};
