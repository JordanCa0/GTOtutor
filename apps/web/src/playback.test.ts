import type { HandView } from '@gtotutor/shared-types';
import { describe, expect, it } from 'vitest';
import { actingAt, finalPlayback, initialPlayback, isPlaybackDone, nextPlayback, potAt, seatsAt, type PlaybackState } from './playback';

function hand(overrides: Partial<HandView> = {}): HandView {
  return {
    id: 'h1',
    config: { tableSize: 'SIX_MAX', stackDepthBb: 100 },
    heroPosition: 'BB',
    heroCards: ['As', 'Kd'],
    seats: (['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'] as const).map((position) => ({
      position,
      isHero: position === 'BB',
      stackBb: 100,
      committedBb: 0,
      folded: false,
      allIn: false,
      cards: position === 'BB' ? ['As', 'Kd'] : null,
    })),
    potBb: 1.5,
    actionLog: [
      { position: 'UTG', action: 'fold', toBb: 0, isHero: false },
      { position: 'HJ', action: 'fold', toBb: 0, isHero: false },
      { position: 'CO', action: 'raise', toBb: 2.5, isHero: false },
      { position: 'BTN', action: 'fold', toBb: 0, isHero: false },
      { position: 'SB', action: 'fold', toBb: 0, isHero: false },
    ],
    legalActions: [],
    pendingSpot: { nodeKey: 'k', nodeLabel: 'BB facing CO open', handClass: 'AKo' },
    status: 'awaiting_hero',
    decisions: [],
    result: null,
    dataSource: { kind: 'fixture', note: '' },
    ...overrides,
  };
}

function runToEnd(h: HandView, from: PlaybackState = initialPlayback(h.id)) {
  const states: PlaybackState[] = [from];
  let next = nextPlayback(from, h);
  while (next) {
    states.push(next.state);
    next = nextPlayback(next.state, h);
  }
  return states;
}

describe('playback', () => {
  it('reveals villain actions one at a time, then waits for hero', () => {
    const h = hand();
    const states = runToEnd(h);
    expect(states.map((s) => s.steps)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(isPlaybackDone(states.at(-1)!, h)).toBe(true);
    expect(actingAt(h, states.at(-1)!)).toBe('BB');
    expect(actingAt(h, states[2])).toBe('CO');
  });

  it('reconstructs bets, folds and the pot from a log prefix', () => {
    const h = hand();
    const seats = seatsAt(h, 3);
    expect(seats.CO.committed).toBe(2.5);
    expect(seats.UTG.folded).toBe(true);
    expect(seats.BTN.folded).toBe(false);
    expect(potAt(seats)).toBe(4);
    expect(potAt(seatsAt(h, 0))).toBe(1.5);
  });

  it('after the hand ends: gather, flop, turn, river, showdown, award', () => {
    const h = hand({
      status: 'complete',
      actionLog: [...hand().actionLog, { position: 'BB', action: 'call', toBb: 2.5, isHero: true }],
      result: {
        board: ['2c', '7d', 'Jh', 'Qs', '3c'],
        showdown: [
          { position: 'CO', cards: ['Th', 'Td'], handName: 'Pair', isWinner: true },
          { position: 'BB', cards: ['As', 'Kd'], handName: 'High card', isWinner: false },
        ],
        winners: ['CO'],
        potBb: 5.5,
        heroNetBb: -2.5,
        summary: '',
      },
    });
    const from = { ...initialPlayback(h.id), steps: 5 };
    const states = runToEnd(h, from);
    expect(states.map((s) => s.board)).toEqual([0, 0, 0, 3, 4, 5, 5, 5]);
    expect(states.at(-1)).toEqual(finalPlayback(h));
    const heroStep = nextPlayback(from, h)!;
    expect(heroStep.delay).toBeLessThan(300);
  });

  it('uncontested hands skip the board and showdown', () => {
    const h = hand({
      status: 'complete',
      actionLog: [...hand().actionLog, { position: 'BB', action: 'fold', toBb: 1, isHero: true }],
      result: { board: [], showdown: null, winners: ['CO'], potBb: 4, heroNetBb: -1, summary: '' },
    });
    const last = runToEnd(h).at(-1)!;
    expect(last).toMatchObject({ gathered: true, board: 0, showdown: false, awarded: true });
    expect(last).toEqual(finalPlayback(h));
  });
});
