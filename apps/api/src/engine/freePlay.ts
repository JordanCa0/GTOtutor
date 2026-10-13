import type { LegalAction, Position } from '@gtotutor/shared-types';
import { describeHand } from '../archetypes/handReading.js';

/**
 * Free play (docs/archetypes.md): a heads-up pot against an opponent JEV AI plays, in a spot with no
 * solved flops (a limped pot outside the SB, say). The flop, turn and river are played on a fixed
 * betting tree, the opponent's actions come from Jev, and hero's decisions aren't graded: there is
 * no solver answer to grade them against.
 */
export interface FreePlayState {
  /** [OOP, IP]: OOP acts first on every street. */
  seats: [Position, Position];
  street: 'flop' | 'turn' | 'river';
  /** What each player had in when the street started. */
  base: number;
  /** Each player's bet on this street (a street total, as the table shows it). */
  streetBets: Partial<Record<Position, number>>;
  /** Who acted on this street, in order. */
  acted: Position[];
  /** Bets and raises on this street: a bet, then at most one raise. */
  aggression: number;
  /** JEV AI's frequencies for the opponent's pending decision, and who made them (see HandEngine). */
  villainChoice?: number[] | null;
  villainSource?: { by: 'jev' | 'rules'; ms?: number } | null;
}

/** The solved games' sizes, as shares of the pot: 33/66/100% on the flop, 33/75/125% on the turn, 50/100% (and all-in) on the river. */
const BET_SIZES: Record<FreePlayState['street'], number[]> = { flop: [0.33, 0.66, 1], turn: [0.33, 0.75, 1.25], river: [0.5, 1] };
const MAX_AGGRESSION = 2;
/** A raise is to three times the bet faced. */
const RAISE_FACTOR = 3;

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

export const FREE_PLAY_NOTE = "This pot type has no solver data, so the hand is played out against JEV AI and your decisions after the flop aren't graded.";

/**
 * The legal actions for the player to act. Amounts are street totals; `behind` is what the player
 * can still put in this street (the effective stack less what's in).
 */
export function freeActions(street: FreePlayState['street'], potBb: number, myBet: number, oppBet: number, behind: number, aggression: number): LegalAction[] {
  const allIn = round2(myBet + behind);
  const allInAction: LegalAction = { id: 'allin', label: `All-in ${allIn}`, toBb: allIn };
  if (oppBet > myBet) {
    const call = round2(Math.min(oppBet, allIn));
    const out: LegalAction[] = [
      { id: 'fold', label: 'Fold', toBb: null },
      { id: 'call', label: `Call ${call}`, toBb: call },
    ];
    if (aggression < MAX_AGGRESSION && allIn > oppBet) {
      const raise = round1(oppBet * RAISE_FACTOR);
      out.push(raise < allIn ? { id: 'raise', label: `Raise to ${raise}`, toBb: raise } : allInAction);
    }
    return out;
  }
  const out: LegalAction[] = [{ id: 'check', label: 'Check', toBb: null }];
  if (behind <= 0) return out;
  let capped = street === 'river';
  for (const share of BET_SIZES[street]) {
    const bet = Math.max(1, round1(share * potBb));
    if (bet >= allIn) capped = true;
    else if (!out.some((a) => a.toBb === bet)) out.push({ id: 'bet', label: `Bet ${bet}`, toBb: bet });
  }
  if (capped) out.push(allInAction);
  return out;
}

/**
 * The opponent's play when JEV AI fails or is too slow: check when free, call with a pair it made
 * or a draw before the river, otherwise fold. One-hot over `actions`.
 */
export function ruleChoice(actions: LegalAction[], cards: string[], board: string[]): number[] {
  const pick = (id: string) => actions.map((a) => (a.id === id ? 1 : 0));
  if (actions.some((a) => a.id === 'check')) return pick('check');
  const { madeHand, draws } = describeHand(cards, board);
  const made = !/^no pair|^only the board|on the board/.test(madeHand);
  return made || (draws.length > 0 && board.length < 5) ? pick('call') : pick('fold');
}
