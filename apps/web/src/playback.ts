import type { ActionLogEntry, HandView, Position } from '@gtotutor/shared-types';

/**
 * The server resolves a whole street instantly; the client replays it step by step.
 * Everything the table shows is derived from how far playback has advanced.
 */
export interface PlaybackState {
  handId: string;
  /** Number of action-log entries revealed. */
  steps: number;
  /** Bets swept into the pot. */
  gathered: boolean;
  /** Board cards revealed (0, 3, 4, 5). */
  board: number;
  /** Villain hole cards flipped at showdown. */
  showdown: boolean;
  /** Pot pushed to the winner(s). */
  awarded: boolean;
}

export const TIMING = {
  deal: 750,
  villainAction: 520,
  heroAction: 150,
  gather: 420,
  flop: 550,
  street: 650,
  showdown: 600,
  award: 700,
};

export const initialPlayback = (handId: string): PlaybackState => ({
  handId,
  steps: 0,
  gathered: false,
  board: 0,
  showdown: false,
  awarded: false,
});

/** Board cards showing during each street. */
const BOARD_FOR = { preflop: 0, flop: 3, turn: 4, river: 5 } as const;

export function finalPlayback(hand: HandView): PlaybackState {
  const complete = hand.status === 'complete';
  const lastStreet = hand.actionLog.at(-1)?.street ?? 'preflop';
  return {
    handId: hand.id,
    steps: hand.actionLog.length,
    // Mid-hand on a new street with no action yet, the earlier bets already sit in the pot.
    gathered: complete || BOARD_FOR[lastStreet] < hand.board.length,
    board: Math.max(hand.result?.board.length ?? 0, hand.board.length),
    showdown: complete && hand.result?.showdown !== null,
    awarded: complete,
  };
}

/**
 * Sweeps the bets and deals the next street's card(s) before its first action, or before hero's
 * decision (or the live solve being waited for) on it.
 */
function streetStep(p: PlaybackState, hand: HandView): { state: PlaybackState; delay: number } | null {
  const next = hand.actionLog[p.steps];
  const want = next ? BOARD_FOR[next.street] : hand.status === 'awaiting_hero' ? hand.board.length : 0;
  if (p.board >= want || hand.board.length < want) return null;
  if (!p.gathered) return { state: { ...p, gathered: true }, delay: TIMING.gather };
  return { state: { ...p, board: p.board === 0 ? 3 : p.board + 1 }, delay: p.board === 0 ? TIMING.flop : TIMING.street };
}

/** The next playback step and how long to wait before showing it, or null when caught up. */
export function nextPlayback(p: PlaybackState, hand: HandView): { state: PlaybackState; delay: number } | null {
  const log = hand.actionLog;
  const street = streetStep(p, hand);
  if (street) return street;
  if (p.steps < log.length) {
    const delay = p.steps === 0 ? TIMING.deal : log[p.steps].isHero ? TIMING.heroAction : TIMING.villainAction;
    // New bets on a later street sit in front of the players again until swept.
    const gathered = log[p.steps].street === 'preflop' ? p.gathered : false;
    return { state: { ...p, steps: p.steps + 1, gathered }, delay };
  }
  const r = hand.result;
  if (hand.status !== 'complete' || !r) return null;
  if (!p.gathered) return { state: { ...p, gathered: true }, delay: log.length === 0 ? TIMING.deal : TIMING.gather };
  if (p.board < r.board.length) {
    const board = p.board === 0 ? 3 : p.board + 1;
    return { state: { ...p, board }, delay: p.board === 0 ? TIMING.flop : TIMING.street };
  }
  if (r.showdown && !p.showdown) return { state: { ...p, showdown: true }, delay: TIMING.showdown };
  if (!p.awarded) return { state: { ...p, awarded: true }, delay: r.showdown ? TIMING.award : TIMING.gather };
  return null;
}

export const isPlaybackDone = (p: PlaybackState, hand: HandView) => nextPlayback(p, hand) === null;

export interface SeatDisplay {
  /** Total put in this hand. */
  committed: number;
  /** Put in on the street shown (the chips in front of the seat). */
  streetBet: number;
  folded: boolean;
  allIn: boolean;
  lastAction: ActionLogEntry | null;
}

export function seatsAt(hand: HandView, steps: number): Record<Position, SeatDisplay> {
  const out = {} as Record<Position, SeatDisplay>;
  for (const s of hand.seats) {
    const blind = s.position === 'SB' ? 0.5 : s.position === 'BB' ? 1 : 0;
    out[s.position] = { committed: blind, streetBet: blind, folded: false, allIn: false, lastAction: null };
  }
  let street = 'preflop';
  for (const a of hand.actionLog.slice(0, steps)) {
    if (a.street !== street) {
      street = a.street;
      for (const seat of Object.values(out)) {
        seat.streetBet = 0;
        seat.lastAction = null;
      }
    }
    const seat = out[a.position];
    seat.lastAction = a;
    if (a.action === 'fold') seat.folded = true;
    else {
      seat.committed = a.toBb;
      seat.streetBet = a.streetBb ?? a.toBb;
    }
    if (seat.committed >= hand.config.stackDepthBb) seat.allIn = true;
  }
  return out;
}

export const potAt = (seats: Record<Position, SeatDisplay>) =>
  Math.round(Object.values(seats).reduce((s, x) => s + x.committed, 0) * 100) / 100;

/** Whose turn it looks like on screen: the next revealed action's seat, or hero when waiting. */
export function actingAt(hand: HandView, p: PlaybackState): Position | null {
  if (p.steps < hand.actionLog.length) return hand.actionLog[p.steps].position;
  return hand.status === 'awaiting_hero' ? hand.heroPosition : null;
}
