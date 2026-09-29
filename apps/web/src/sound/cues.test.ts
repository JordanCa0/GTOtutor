import type { HandView } from '@gtotutor/shared-types';
import { describe, expect, it } from 'vitest';
import { initialPlayback } from '../playback';
import { condensedCuesFor, cuesFor } from './cues';

const hand = {
  id: 'h1',
  seats: Array.from({ length: 6 }, () => ({})),
  actionLog: [
    { position: 'UTG', action: 'fold', toBb: 0, isHero: false },
    { position: 'CO', action: 'raise', toBb: 2.5, isHero: false },
    { position: 'BB', action: 'allin', toBb: 100, isHero: true },
  ],
} as unknown as HandView;

const sounds = (cues: { sound: string }[]) => cues.map((c) => c.sound);

describe('sound cues', () => {
  it('deals two cards to every seat when a new hand appears', () => {
    const cues = cuesFor(null, initialPlayback('h1'), hand);
    expect(cues).toHaveLength(12);
    expect(new Set(sounds(cues))).toEqual(new Set(['deal']));
    expect(cues.at(-1)!.delayMs).toBeGreaterThan(cues[0].delayMs);
  });

  it('maps revealed actions to muck / chip / all-in sounds', () => {
    const p = initialPlayback('h1');
    expect(sounds(cuesFor(p, { ...p, steps: 3 }, hand))).toEqual(['muck', 'chip', 'allin']);
  });

  it('plays the runout: sweep into the pot, board cards, showdown flips, pot to winner', () => {
    const p = { ...initialPlayback('h1'), steps: 3 };
    expect(sounds(cuesFor(p, { ...p, gathered: true }, hand))).toEqual(['sweep']);
    expect(sounds(cuesFor({ ...p, gathered: true }, { ...p, gathered: true, board: 3 }, hand))).toEqual(['deal', 'deal', 'deal']);
    const river = { ...p, gathered: true, board: 5 };
    expect(sounds(cuesFor(river, { ...river, showdown: true }, hand))).toEqual(['deal', 'deal']);
    expect(sounds(cuesFor({ ...river, showdown: true }, { ...river, showdown: true, awarded: true }, hand))).toEqual(['sweep']);
  });

  it('with animations off, plays each kind of sound once for a whole hand', () => {
    const final = { ...initialPlayback('h1'), steps: 3, gathered: true, awarded: true };
    const cues = condensedCuesFor(null, final, hand, false);
    expect(sounds(cues)).toEqual(['deal', 'muck', 'chip', 'allin', 'sweep']);
    expect(cues.map((c) => c.delayMs)).toEqual([0, 70, 140, 210, 280]);
    expect(condensedCuesFor(final, final, hand, false)).toEqual([]);
  });

  it('stays quiet when nothing changed', () => {
    const p = { ...initialPlayback('h1'), steps: 2 };
    expect(cuesFor(p, p, hand)).toEqual([]);
  });
});
