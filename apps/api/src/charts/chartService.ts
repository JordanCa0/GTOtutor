import type { ChartNodeView, DataSource } from '@gtotutor/shared-types';
import { ALL_HAND_CLASSES, comboCount } from '../poker/cards.js';
import type { ChartNode, ChartSet } from './types.js';

export class ChartService {
  constructor(private readonly charts: ChartSet) {}

  get dataSource(): DataSource {
    return this.charts.dataSource;
  }

  getNode(nodeKey: string): ChartNode {
    const node = this.charts.nodes.get(nodeKey);
    if (!node) throw new Error(`No chart node for key ${nodeKey}`);
    return node;
  }

  hasNode(nodeKey: string): boolean {
    return this.charts.nodes.has(nodeKey);
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
