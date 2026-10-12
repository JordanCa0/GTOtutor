import { describe, expect, it } from 'vitest';
import { dealRequest, type DealSettings } from './SetupScreen';

const base: DealSettings = { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'CO', skipEasyFolds: true, simplePots: false };

describe('dealRequest', () => {
  it('rotating, starts at the chosen seat and moves one seat a hand, as the button does', () => {
    const settings = { ...base, rotate: true };
    expect(dealRequest(settings, null).heroPosition).toBe('CO');
    const seats = ['UTG', 'BB', 'SB', 'BTN', 'CO', 'HJ', 'UTG'] as const;
    for (let i = 0; i + 1 < seats.length; i++) expect(dealRequest(settings, seats[i]).heroPosition).toBe(seats[i + 1]);
  });

  it('rotating from Random starts in a real seat', () => {
    expect(['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB']).toContain(dealRequest({ ...base, heroPosition: 'random', rotate: true }, null).heroPosition);
  });

  it('not rotating, sends the setting as it is, without the rotate flag (the API rejects unknown fields)', () => {
    expect(dealRequest({ ...base, heroPosition: 'random', rotate: false }, 'BTN')).toEqual({ ...base, heroPosition: 'random' });
    expect(dealRequest({ ...base, rotate: false }, 'BTN')).not.toHaveProperty('rotate');
  });
});
