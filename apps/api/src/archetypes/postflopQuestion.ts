import type { ActionLogEntry, Archetype, LegalAction, Position, Street } from '@gtotutor/shared-types';
import { ARCHETYPE_DEFS } from './archetypes.js';
import { optionNames, type PostflopQuestion } from './archetypeService.js';
import { describeHand } from './handReading.js';

export interface PostflopSituation {
  archetype: Archetype;
  street: Street;
  board: string[];
  cards: string[];
  position: Position;
  /** The players still in against this one: one heads-up, more in a multiway pot. */
  opponents: Position[];
  /** Every opponent acts before this player on each street. */
  inPosition: boolean;
  potBb: number;
  /** Still to put in to call (0 when checked to). */
  toCallBb: number;
  /** Chips this player has behind (capped at the effective stack). */
  behindBb: number;
  /** This player's bet on the street so far. */
  streetBetBb: number;
  actionLog: ActionLogEntry[];
  /** The legal actions, as the table shows them (bet and raise amounts are street totals). */
  actions: LegalAction[];
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** One postflop decision as JEV AI sees it: the board, the hand read, the betting, and the options. */
export function buildPostflopQuestion(s: PostflopSituation): PostflopQuestion {
  const read = describeHand(s.cards, s.board);
  const names = optionNames(s.actions);
  const options = s.actions.map((a, i): [string, string] => [names[i], optionText(a, s)]);
  const def = ARCHETYPE_DEFS[s.archetype];
  return {
    state: {
      game: `6-max no-limit Texas hold'em cash game; ${s.opponents.length > 1 ? `${s.opponents.length + 1}-way` : 'heads-up'} after the flop`,
      street: s.street,
      board: s.board.join(' '),
      my_cards: s.cards.join(' '),
      my_hand: read.madeHand,
      my_draws: read.draws.length ? read.draws.join(', ') : 'none',
      my_position: `${s.position}, ${s.inPosition ? 'in position (I act last)' : 'out of position (I act first)'}`,
      opponent_position: s.opponents.join(', '),
      pot_bb: s.potBb,
      to_call_bb: s.toCallBb,
      my_stack_behind_bb: s.behindBb,
      action_so_far: actionHistory(s.actionLog, s.board),
      player: `${def.description} After the flop: ${def.postflop}`,
      task: 'Decide what this player type would really do here, including their typical mistakes. Answer as them, not as a balanced player.',
    },
    instructions: `It's my turn on the ${s.street}. Which action do I take?`,
    options,
  };
}

function optionText(a: LegalAction, s: PostflopSituation): string {
  const added = a.toBb !== null ? Math.max(0, a.toBb - s.streetBetBb) : 0;
  switch (a.id) {
    case 'fold':
      return `Fold: give up the hand and the ${s.potBb}bb pot.`;
    case 'check':
      return 'Check: bet nothing.';
    case 'call':
      return `Call ${s.toCallBb}bb to continue.`;
    case 'bet':
      return `Bet ${a.toBb}bb, about ${pct(added / s.potBb)} of the pot.`;
    case 'raise':
      return `Raise to ${a.toBb}bb (${added}bb more, the pot is ${s.potBb}bb).`;
    case 'allin':
      return `Go all-in: ${s.behindBb}bb more.`;
    default:
      return a.label;
  }
}

/** The hand's betting so far, one line per street ("Flop (Ah 7d 2c): BB checks, BTN bets 2.1"). */
export function actionHistory(log: ActionLogEntry[], board: string[] = []): string[] {
  const streets: Street[] = ['preflop', 'flop', 'turn', 'river'];
  const cardsBy: Record<string, string[]> = { flop: board.slice(0, 3), turn: board.slice(3, 4), river: board.slice(4, 5) };
  const lines: string[] = [];
  for (const street of streets) {
    const entries = log.filter((e) => e.street === street && !(street === 'preflop' && e.action === 'fold'));
    if (!entries.length) continue;
    const name = street[0].toUpperCase() + street.slice(1);
    const cards = cardsBy[street]?.length ? ` (${cardsBy[street].join(' ')})` : '';
    lines.push(`${name}${cards}: ${entries.map(entryText).join(', ')}`);
  }
  return lines;
}

function entryText(e: ActionLogEntry): string {
  const amount = e.street === 'preflop' ? e.toBb : (e.streetBb ?? e.toBb);
  switch (e.action) {
    case 'fold':
      return `${e.position} folds`;
    case 'check':
      return `${e.position} checks`;
    case 'call':
      return e.street === 'preflop' && amount <= 1 ? `${e.position} limps` : `${e.position} calls ${amount}`;
    case 'bet':
      return `${e.position} bets ${amount}`;
    case 'raise':
      return `${e.position} raises to ${amount}`;
    case 'allin':
      return `${e.position} goes all-in (${amount})`;
    default:
      return `${e.position} ${e.action}`;
  }
}
