import type { Position, TableSize } from '@gtotutor/shared-types';

export type NodeType =
  | 'RFI'
  | 'VS_OPEN'
  | 'VS_3BET'
  | 'VS_4BET'
  | 'VS_5BET'
  | 'COLD_VS_3BET'
  | 'COLD_VS_4BET'
  | 'COLD_VS_5BET';

export const FACING_TYPES: Record<number, { direct: NodeType; cold: NodeType }> = {
  2: { direct: 'VS_3BET', cold: 'COLD_VS_3BET' },
  3: { direct: 'VS_4BET', cold: 'COLD_VS_4BET' },
  4: { direct: 'VS_5BET', cold: 'COLD_VS_5BET' },
};

export function makeNodeKey(
  tableSize: TableSize,
  stackBb: number,
  type: NodeType,
  pos: Position,
  vs?: Position,
): string {
  return [tableSize, stackBb, type, pos, vs].filter((p) => p !== undefined).join('|');
}
