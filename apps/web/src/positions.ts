import type { Position } from '@gtotutor/shared-types';

/** What each 6-max seat is called and why it plays the way it does: the table's position tooltips. */
export const POSITION_INFO: Record<Position, { name: string; turn: string; why: string }> = {
  UTG: {
    name: 'Under the gun',
    turn: 'First to act before the flop.',
    why: 'Five players still act behind, so someone often has a strong hand. UTG plays the tightest range at the table.',
  },
  HJ: {
    name: 'Hijack',
    turn: 'Second to act before the flop.',
    why: 'Four players still to act: a little wider than UTG, but still fairly tight.',
  },
  CO: {
    name: 'Cutoff',
    turn: 'Third to act before the flop, the seat before the button.',
    why: 'Only the button and the blinds are left behind, so the cutoff opens a much wider range.',
  },
  BTN: {
    name: 'Button (dealer)',
    turn: 'Last to act on every street after the flop.',
    why: 'Always being in position is the biggest edge at the table, so the button plays the widest range.',
  },
  SB: {
    name: 'Small blind',
    turn: 'Posts 0.5bb before the cards; first to act after the flop.',
    why: 'It already has chips in, but it plays every later street out of position, which makes it the hardest seat.',
  },
  BB: {
    name: 'Big blind',
    turn: 'Posts 1bb before the cards; last to act before the flop, early after it.',
    why: 'With 1bb already in, calling a raise is cheap, so the big blind defends wide, then plays out of position after the flop.',
  },
};
