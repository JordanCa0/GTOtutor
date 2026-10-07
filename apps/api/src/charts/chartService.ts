import type { ChartNodeView, DataSource } from '@gtotutor/shared-types';
import { ALL_HAND_CLASSES, comboCount } from '../poker/cards.js';
import { NOCALL_SUFFIX } from './nodeKeys.js';
import type { ChartNode, ChartSet } from './types.js';

export class ChartService {
  constructor(private readonly charts: ChartSet) {}

  get dataSource(): DataSource {
    return this.charts.dataSource;
  }

  getNode(nodeKey: string): ChartNode {
    const node = this.charts.nodes.get(nodeKey) ?? this.deriveNoCall(nodeKey);
    if (!node) throw new Error(`No chart node for key ${nodeKey}`);
    return node;
  }

  hasNode(nodeKey: string): boolean {
    return this.charts.nodes.has(nodeKey) || this.deriveNoCall(nodeKey) !== null;
  }

  /**
   * A "|nocall" node the charts don't have (placeholder charts, or a line the preflop solver never
   * reached): the base node without its call action, with calls turned into folds.
   */
  private deriveNoCall(nodeKey: string): ChartNode | null {
    if (!nodeKey.endsWith(NOCALL_SUFFIX)) return null;
    const base = this.charts.nodes.get(nodeKey.slice(0, -NOCALL_SUFFIX.length));
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
    this.charts.nodes.set(nodeKey, node);
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
