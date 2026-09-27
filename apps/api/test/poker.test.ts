import { describe, expect, it } from 'vitest';
import { ALL_HAND_CLASSES, comboCount, fullDeck, handClass, shuffle } from '../src/poker/cards.js';
import { bestHand, compareScores, evaluate5 } from '../src/poker/evaluator.js';
import { seededRng } from '../src/poker/rng.js';

describe('cards', () => {
  it('builds a 52-card deck and shuffles without losing cards', () => {
    const deck = shuffle(fullDeck(), seededRng(1));
    expect(new Set(deck).size).toBe(52);
    expect(deck).not.toEqual(fullDeck());
  });

  it('maps hole cards to canonical classes', () => {
    expect(handClass('Ah', 'Kh')).toBe('AKs');
    expect(handClass('Kd', 'As')).toBe('AKo');
    expect(handClass('7c', '7d')).toBe('77');
    expect(handClass('2s', 'Ts')).toBe('T2s');
  });

  it('has 169 classes covering all 1326 combos', () => {
    expect(new Set(ALL_HAND_CLASSES).size).toBe(169);
    expect(ALL_HAND_CLASSES.reduce((s, hc) => s + comboCount(hc), 0)).toBe(1326);
  });

  it('shuffle is roughly uniform on card position', () => {
    const rng = seededRng(7);
    const counts = new Map<string, number>();
    for (let i = 0; i < 26000; i++) {
      const top = shuffle(fullDeck(), rng)[0];
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    for (const c of counts.values()) expect(c).toBeGreaterThan(380); // expected 500
  });
});

describe('evaluator', () => {
  const cat = (cards: string) => evaluate5(cards.split(' '))[0];

  it('classifies every category', () => {
    expect(cat('Ah Kh Qh Jh Th')).toBe(8);
    expect(cat('9c 9d 9h 9s 2c')).toBe(7);
    expect(cat('3c 3d 3h 2s 2c')).toBe(6);
    expect(cat('Ah 9h 7h 4h 2h')).toBe(5);
    expect(cat('5c 4d 3h 2s Ac')).toBe(4);
    expect(cat('Qc Qd Qh 7s 2c')).toBe(3);
    expect(cat('Qc Qd 7h 7s 2c')).toBe(2);
    expect(cat('Qc Qd 8h 7s 2c')).toBe(1);
    expect(cat('Kc Qd 8h 7s 2c')).toBe(0);
  });

  it('ranks the wheel below a six-high straight', () => {
    expect(compareScores(evaluate5('5c 4d 3h 2s Ac'.split(' ')), evaluate5('6c 5d 4h 3s 2c'.split(' ')))).toBeLessThan(0);
  });

  it('uses kickers', () => {
    expect(compareScores(evaluate5('Ac Ad Kh 7s 2c'.split(' ')), evaluate5('As Ah Qh 7d 2d'.split(' ')))).toBeGreaterThan(0);
  });

  it('picks the best 5 of 7', () => {
    expect(bestHand('Ah Kh 2c 3d Qh Jh Th'.split(' ')).name).toBe('Straight flush');
    expect(bestHand('As Ad 2c 2d 7h 9s Kc'.split(' ')).name).toBe('Two pair');
  });
});
