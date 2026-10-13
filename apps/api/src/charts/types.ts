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
  /** A manifest's equal-stack profiles: profile -> the version of its chart file ("100" -> "preflop-v9"). */
  profileVersions?: Record<string, string>;
  /** Profiles left on disk until needed (ChartService loads them): profile -> chart file. */
  lazy?: Record<string, string>;
}
