import type { DataSource, LegalAction } from '@gtotutor/shared-types';

export interface ChartNode {
  nodeKey: string;
  label: string;
  actions: LegalAction[];
  /** handClass -> frequencies aligned with `actions`, summing to 1 */
  strategy: Map<string, number[]>;
  /** handClass -> EV (bb) per action; null when the source has no EV (fixtures) */
  ev: Map<string, (number | null)[]>;
}

export interface ChartSet {
  version: string;
  dataSource: DataSource;
  nodes: Map<string, ChartNode>;
}
