import type { Position, TableSize } from '@gtotutor/shared-types';

export type NodeType =
  | 'RFI'
  | 'VS_LIMP'
  | 'VS_ISO'
  | 'VS_OPEN'
  | 'VS_3BET'
  | 'VS_4BET'
  | 'VS_5BET'
  | 'COLD_VS_3BET'
  | 'COLD_VS_4BET'
  | 'COLD_VS_5BET'
  /** Facing an all-in below the 5-bet (only with a 20bb stack at the table): fold or call. */
  | 'VS_ALLIN';

export const FACING_TYPES: Record<number, { direct: NodeType; cold: NodeType }> = {
  2: { direct: 'VS_3BET', cold: 'COLD_VS_3BET' },
  3: { direct: 'VS_4BET', cold: 'COLD_VS_4BET' },
  4: { direct: 'VS_5BET', cold: 'COLD_VS_5BET' },
};

export function makeNodeKey(
  tableSize: TableSize,
  /** The stack profile: a depth (100) or a mixed profile ("100:BB20"), as in the chart files. */
  stackBb: number | string,
  type: NodeType,
  pos: Position,
  vs?: Position,
): string {
  return [tableSize, stackBb, type, pos, vs].filter((p) => p !== undefined).join('|');
}

/**
 * Suffix for a node's variant where calling isn't allowed because someone has already called
 * (pots stay heads-up). Fold and raise only.
 */
export const NOCALL_SUFFIX = '|nocall';
