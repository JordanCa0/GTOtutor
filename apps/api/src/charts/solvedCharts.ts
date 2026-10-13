import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
 * Several stack profiles' charts in one set (docs/stack-depths-plan.md): each profile's chart file,
 * relative to the manifest. Node keys carry the profile, so the files never collide.
 */
interface ChartManifest {
  version: string;
  profiles: Record<string, string>;
}

export interface LoadOptions {
  /**
   * Leave mixed-stack profiles ("100:BB20") on disk: ChartService reads each one when a hand first
   * needs it and keeps only the recently used ones. Equal-stack profiles always load. Off, every
   * profile loads now (scripts and tests that walk all the nodes).
   */
  lazyMixed?: boolean;
}

/**
 * Loads preflop solver output as a ChartSet: one chart file, or a manifest of one file per stack
 * profile. Chart nodes the solver never reaches (lines the engine can't produce either) keep their
 * placeholder version so every key still resolves.
 */
export function loadSolvedCharts(path: string, { lazyMixed = false }: LoadOptions = {}): ChartSet {
  const json = JSON.parse(readFileSync(path, 'utf8')) as SolvedChartFile | ChartManifest;
  if (!('profiles' in json)) return { version: json.version, dataSource: json.dataSource, nodes: withPlaceholders([json]) };

  const entries = Object.entries(json.profiles).map(([profile, file]) => [profile, resolve(dirname(path), file)] as const);
  if (!entries.length) throw new Error(`${path} lists no chart files`);
  // A missing file should stop the server at startup, not a hand halfway through.
  const missing = entries.filter(([, file]) => !existsSync(file));
  if (missing.length) throw new Error(`${path}: missing chart files for ${missing.map(([p]) => p).join(', ')}`);
  const lazy = entries.filter(([profile]) => lazyMixed && profile.includes(':'));
  const eagerEntries = entries.filter((e) => !lazy.includes(e));
  const eager = eagerEntries.map(([, file]) => readChartFile(file));
  return {
    version: json.version,
    profileVersions: Object.fromEntries(eagerEntries.map(([profile], i) => [profile, eager[i].version])),
    dataSource: (eager[0] ?? readChartFile(entries[0][1])).dataSource,
    nodes: withPlaceholders(eager),
    ...(lazy.length && { lazy: Object.fromEntries(lazy) }),
  };
}

/** One profile's chart file as nodes by key (ChartService reads lazy profiles with it). */
export function readChartNodes(path: string): Map<string, ChartNode> {
  return toNodes(readChartFile(path), new Map());
}

/** Placeholders first, so every solved node replaces its placeholder. */
function withPlaceholders(files: SolvedChartFile[]): Map<string, ChartNode> {
  const nodes = new Map(buildFixtureChartSet().nodes);
  for (const f of files) toNodes(f, nodes);
  return nodes;
}

function toNodes(file: SolvedChartFile, into: Map<string, ChartNode>): Map<string, ChartNode> {
  for (const n of file.nodes) {
    into.set(n.nodeKey, {
      nodeKey: n.nodeKey,
      label: n.label,
      actions: n.actions.map((a) => ({ id: a.id, label: a.label, toBb: a.toBb ?? null })),
      strategy: new Map(Object.entries(n.strategy)),
      ev: new Map(Object.entries(n.ev)),
    });
  }
  return into;
}

const readChartFile = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as SolvedChartFile;

/**
 * Solved charts when PREFLOP_CHARTS points at a chart file or manifest, otherwise the placeholder
 * charts. The server leaves mixed-stack profiles on disk until a hand needs them.
 */
export function chartsFromEnv(path = process.env.PREFLOP_CHARTS, options: LoadOptions = {}): ChartSet {
  return path ? loadSolvedCharts(path, options) : buildFixtureChartSet();
}
