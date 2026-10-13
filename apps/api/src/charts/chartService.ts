import { STACK_DEPTHS, type ChartNodeView, type DataSource, type StackDepth, type TableOptions } from '@gtotutor/shared-types';
import { mixedKind, profileBase } from './stackProfile.js';
import { ALL_HAND_CLASSES, comboCount } from '../poker/cards.js';
import { NOCALL_SUFFIX } from './nodeKeys.js';
import { readChartNodes } from './solvedCharts.js';
import type { ChartNode, ChartSet } from './types.js';

export class ChartService {
  /** Lazy profiles in memory, least recently used first. */
  private readonly loaded = new Map<string, Map<string, ChartNode>>();

  constructor(
    private readonly charts: ChartSet,
    /** How many lazy (mixed-stack) profiles to keep in memory; the rest are read again when needed. */
    private readonly maxLoaded = 16,
  ) {}

  get dataSource(): DataSource {
    return this.charts.dataSource;
  }

  get version(): string {
    return this.charts.version;
  }

  /**
   * The version of one profile's charts: its own chart file's in a manifest (stacks-v1's "100" is
   * preflop-v9), else the charts' version. Archetype charts are named by it, so a manifest reuses the
   * ones built for its 100bb charts.
   */
  profileVersion(profile: string): string {
    return this.charts.profileVersions?.[profile] ?? this.charts.version;
  }

  /** The node keys the charts hold (not lazy profiles until loaded, nor derived "|nocall" nodes). */
  nodeKeys(): string[] {
    return [...this.charts.nodes.keys()];
  }

  private profileList: string[] | null = null;

  /** The stack profiles the charts cover ("100", "20", "100:BB20"…): the loaded node keys' and the lazy ones. */
  get profiles(): string[] {
    this.profileList ??= [...new Set([...[...this.charts.nodes.keys()].map((k) => k.split('|')[1]), ...Object.keys(this.charts.lazy ?? {})])];
    return this.profileList;
  }

  /** Lazy profiles currently in memory (for tests). */
  get loadedProfiles(): string[] {
    return [...this.loaded.keys()];
  }

  /**
   * The nodes a key looks in: its profile's, read from disk on first use when that profile is lazy
   * (dropping the least recently used beyond `maxLoaded`), else the loaded set.
   */
  private nodesFor(nodeKey: string): Map<string, ChartNode> {
    const profile = nodeKey.split('|')[1];
    const file = profile !== undefined ? this.charts.lazy?.[profile] : undefined;
    if (!file) return this.charts.nodes;
    let nodes = this.loaded.get(profile);
    if (nodes) this.loaded.delete(profile);
    else nodes = readChartNodes(file);
    this.loaded.set(profile, nodes);
    if (this.loaded.size > this.maxLoaded) this.loaded.delete(this.loaded.keys().next().value!);
    return nodes;
  }

  /** What the charts can deal: equal-stack depths, and the depths that also have mixed-stack profiles. */
  tableOptions(): TableOptions {
    const depths = (ids: string[]) => [...new Set(ids.map(profileBase))].filter((d): d is StackDepth => STACK_DEPTHS.some((s) => s.id === d)).sort((a, b) => a - b);
    return {
      stackDepths: depths(this.profiles.filter((p) => mixedKind(p) === null)),
      mixedStacks: { one: depths(this.profiles.filter((p) => mixedKind(p) === 'one')), several: depths(this.profiles.filter((p) => mixedKind(p) === 'several')) },
    };
  }

  getNode(nodeKey: string): ChartNode {
    const node = this.nodesFor(nodeKey).get(nodeKey) ?? this.deriveNoCall(nodeKey);
    if (!node) throw new Error(`No chart node for key ${nodeKey}`);
    return node;
  }

  hasNode(nodeKey: string): boolean {
    return this.nodesFor(nodeKey).has(nodeKey) || this.deriveNoCall(nodeKey) !== null;
  }

  /**
   * A "|nocall" node the charts don't have (placeholder charts, or a line the preflop solver never
   * reached): the base node without its call action, with calls turned into folds.
   */
  private deriveNoCall(nodeKey: string): ChartNode | null {
    if (!nodeKey.endsWith(NOCALL_SUFFIX)) return null;
    const nodes = this.nodesFor(nodeKey);
    const base = nodes.get(nodeKey.slice(0, -NOCALL_SUFFIX.length));
    if (!base) return null;
    const call = base.actions.findIndex((a) => a.id === 'call');
    const fold = base.actions.findIndex((a) => a.id === 'fold');
    const keep = base.actions.map((_, i) => i).filter((i) => i !== call);
    const strategy = new Map<string, number[]>();
    const ev = new Map<string, (number | null)[]>();
    for (const [hc, f] of base.strategy) {
      strategy.set(hc, keep.map((i) => f[i] + (i === fold && call >= 0 ? f[call] : 0)));
      ev.set(hc, keep.map((i) => base.ev.get(hc)![i]));
    }
    const node: ChartNode = { nodeKey, label: `${base.label} (no overcall)`, actions: keep.map((i) => base.actions[i]), strategy, ev };
    nodes.set(nodeKey, node);
    return node;
  }

  toView(node: ChartNode): ChartNodeView {
    return {
      nodeKey: node.nodeKey,
      label: node.label,
      actions: node.actions,
      strategy: Object.fromEntries(node.strategy),
      dataSource: this.charts.dataSource,
    };
  }

  /** Combo-weighted share of the whole range taking each action at this node (0-1). */
  rangeSummary(node: ChartNode): number[] {
    const totals = node.actions.map(() => 0);
    let combos = 0;
    for (const hc of ALL_HAND_CLASSES) {
      const c = comboCount(hc);
      combos += c;
      node.strategy.get(hc)!.forEach((f, i) => (totals[i] += f * c));
    }
    return totals.map((t) => t / combos);
  }
}
