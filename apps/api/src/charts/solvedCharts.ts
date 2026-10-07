import { readFileSync } from 'node:fs';
import type { DataSource, LegalAction } from '@gtotutor/shared-types';
import { buildFixtureChartSet } from './fixtures.js';
import type { ChartNode, ChartSet } from './types.js';

/** The JSON the preflop solver writes (`preflop/charts/<version>.json`). */
interface SolvedChartFile {
  version: string;
  dataSource: DataSource;
  nodes: {
    nodeKey: string;
    label: string;
    actions: LegalAction[];
    strategy: Record<string, number[]>;
    ev: Record<string, number[]>;
  }[];
}

/**
 * Loads preflop solver output as a ChartSet. Chart nodes the solver never reaches (lines the engine
 * can't produce either) keep their placeholder version so every key still resolves.
 */
export function loadSolvedCharts(path: string): ChartSet {
  const file = JSON.parse(readFileSync(path, 'utf8')) as SolvedChartFile;
  const nodes = new Map(buildFixtureChartSet().nodes);
  for (const n of file.nodes) {
    const node: ChartNode = {
      nodeKey: n.nodeKey,
      label: n.label,
      actions: n.actions.map((a) => ({ id: a.id, label: a.label, toBb: a.toBb ?? null })),
      strategy: new Map(Object.entries(n.strategy)),
      ev: new Map(Object.entries(n.ev)),
    };
    nodes.set(n.nodeKey, node);
  }
  return { version: file.version, dataSource: file.dataSource, nodes };
}

/** Solved charts when PREFLOP_CHARTS points at a file, otherwise the placeholder charts. */
export function chartsFromEnv(path = process.env.PREFLOP_CHARTS): ChartSet {
  return path ? loadSolvedCharts(path) : buildFixtureChartSet();
}
