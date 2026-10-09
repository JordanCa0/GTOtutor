import type { ActionType } from '@gtotutor/shared-types';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { chartsFromEnv, loadSolvedCharts } from '../src/charts/solvedCharts.js';
import { HandEngine } from '../src/engine/handEngine.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { ALL_HAND_CLASSES } from '../src/poker/cards.js';
import { seededRng } from '../src/poker/rng.js';

// The newest chart file the preflop solver has written, if any (preflop/charts/*.json).
const chartsDir = fileURLToPath(new URL('../../../preflop/charts', import.meta.url));
const newest = existsSync(chartsDir)
  ? readdirSync(chartsDir)
      .filter((f) => f.endsWith('.json'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .pop()
  : undefined;

// A minimal file in the preflop solver's output format: one solved node.
function writeChartFile(): string {
  const strategy = Object.fromEntries(ALL_HAND_CLASSES.map((hc) => [hc, hc === 'AA' ? [0, 1] : [1, 0]]));
  const ev = Object.fromEntries(ALL_HAND_CLASSES.map((hc) => [hc, hc === 'AA' ? [0, 6.2] : [0, -1.5]]));
  const file = {
    version: 'preflop-test',
    dataSource: { kind: 'solver', note: 'test charts' },
    nodes: [
      {
        nodeKey: 'SIX_MAX|100|RFI|UTG',
        label: 'UTG first in (open-raise or fold)',
        actions: [
          { id: 'fold', label: 'Fold', toBb: null },
          { id: 'raise', label: 'Raise to 2.5', toBb: 2.5 },
        ],
        strategy,
        ev,
      },
    ],
  };
  const path = join(mkdtempSync(join(tmpdir(), 'charts-')), 'preflop-test.json');
  writeFileSync(path, JSON.stringify(file));
  return path;
}

describe('solved preflop charts', () => {
  it('loads strategies and EVs and marks the data source as solver output', () => {
    const set = loadSolvedCharts(writeChartFile());
    expect(set.version).toBe('preflop-test');
    expect(set.dataSource.kind).toBe('solver');
    const utg = set.nodes.get('SIX_MAX|100|RFI|UTG')!;
    expect(utg.strategy.get('AA')).toEqual([0, 1]);
    expect(utg.ev.get('AA')).toEqual([0, 6.2]);
    expect(utg.actions[1]).toEqual({ id: 'raise', label: 'Raise to 2.5', toBb: 2.5 });
  });

  it('keeps placeholder nodes for keys the solver output lacks', () => {
    const set = loadSolvedCharts(writeChartFile());
    expect(set.nodes.size).toBe(buildFixtureChartSet().nodes.size);
    expect(set.nodes.get('SIX_MAX|100|RFI|BTN')!.ev.get('AA')).toEqual([null, null, null]); // fold, limp, raise
  });

  it.skipIf(!newest)('the engine plays thousands of hands on the newest solved charts', () => {
    const set = loadSolvedCharts(join(chartsDir, newest!));
    for (const n of set.nodes.values()) {
      for (const hc of ALL_HAND_CLASSES) {
        const f = n.strategy.get(hc)!;
        expect(f).toHaveLength(n.actions.length);
        expect(Math.abs(f.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(0.01);
      }
    }
    const engine = new HandEngine(new ChartService(set), seededRng(7), runoutResolver);
    const rng = seededRng(8);
    for (let i = 0; i < 2000; i++) {
      const state = engine.start({ tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'random' });
      let view = engine.view(state);
      let guard = 0;
      while (view.status === 'awaiting_hero') {
        const legal = view.legalActions;
        engine.decide(state, legal[rng.int(legal.length)].id as ActionType);
        view = engine.view(state);
        if (++guard > 10) throw new Error('hand did not terminate');
      }
      expect(view.result).not.toBeNull();
    }
  });

  it('uses the placeholders unless a chart file is given', () => {
    expect(chartsFromEnv('').version).toBe('fixture-v3');
    expect(chartsFromEnv(writeChartFile()).version).toBe('preflop-test');
  });
});
