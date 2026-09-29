import { describe, expect, it } from 'vitest';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { ALL_HAND_CLASSES } from '../src/poker/cards.js';

const charts = new ChartService(buildFixtureChartSet());
const node = (key: string) => charts.getNode(key);
const freq = (key: string, hc: string, action: string) => {
  const n = node(key);
  return n.strategy.get(hc)![n.actions.findIndex((a) => a.id === action)];
};

describe('fixture charts', () => {
  it('every node covers all 169 classes with frequencies summing to 1', () => {
    const set = buildFixtureChartSet();
    for (const n of set.nodes.values()) {
      expect(n.strategy.size).toBe(169);
      for (const hc of ALL_HAND_CLASSES) {
        const f = n.strategy.get(hc)!;
        expect(f).toHaveLength(n.actions.length);
        expect(Math.abs(f.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(0.011);
        f.forEach((x) => expect(x).toBeGreaterThanOrEqual(0));
      }
    }
  });

  it('opens premiums and folds trash from UTG', () => {
    expect(freq('SIX_MAX|100|RFI|UTG', 'AA', 'raise')).toBe(1);
    expect(freq('SIX_MAX|100|RFI|UTG', '72o', 'fold')).toBe(1);
  });

  it('opens wider on the button than UTG', () => {
    const openShare = (pos: string) => charts.rangeSummary(node(`SIX_MAX|100|RFI|${pos}`))[1];
    expect(openShare('BTN')).toBeGreaterThan(openShare('CO'));
    expect(openShare('CO')).toBeGreaterThan(openShare('UTG'));
    expect(openShare('UTG')).toBeCloseTo(0.15, 1);
  });

  it('BB defends wider vs a BTN open than vs a UTG open', () => {
    const defend = (vs: string) => 1 - charts.rangeSummary(node(`SIX_MAX|100|VS_OPEN|BB|${vs}`))[0];
    expect(defend('BTN')).toBeGreaterThan(defend('UTG'));
  });

  it('mixes some wheel-ace 3-bet bluffs', () => {
    const f = freq('SIX_MAX|100|VS_OPEN|BTN|CO', 'A5s', 'raise');
    expect(f).toBeGreaterThan(0.2);
    expect(f).toBeLessThan(1);
  });

  it('lets the SB limp as well as raise, and the BB check or raise against a limp', () => {
    const sb = node('SIX_MAX|100|RFI|SB');
    expect(sb.actions.map((a) => a.id)).toEqual(['fold', 'call', 'raise']);
    const [fold, limp, raise] = charts.rangeSummary(sb);
    expect(limp).toBeGreaterThan(0.25);
    expect(raise).toBeGreaterThan(0.15);
    expect(fold).toBeLessThan(0.5);
    expect(node('SIX_MAX|100|VS_LIMP|BB|SB').actions.map((a) => a.id)).toEqual(['check', 'raise']);
    expect(freq('SIX_MAX|100|VS_LIMP|BB|SB', '72o', 'check')).toBe(1);
    expect(freq('SIX_MAX|100|VS_LIMP|BB|SB', 'AA', 'raise')).toBe(1);
  });

  it('always calls AA against an all-in', () => {
    expect(freq('SIX_MAX|100|VS_5BET|UTG|BB', 'AA', 'call')).toBe(1);
  });
});
