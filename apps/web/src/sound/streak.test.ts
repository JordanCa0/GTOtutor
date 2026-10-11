import { describe, expect, it } from 'vitest';
import { streakStep } from './soundEngine';

describe('streak chime', () => {
  it('climbs one scale step per streak step and stops at an octave', () => {
    expect([0, 1, 2, 3, 4, 8, 20].map(streakStep)).toEqual([0, 0, 2, 4, 5, 12, 12]);
  });
});
