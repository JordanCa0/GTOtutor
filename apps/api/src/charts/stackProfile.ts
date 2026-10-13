import { SIX_MAX_POSITIONS, type MixedStacks, type Position } from '@gtotutor/shared-types';

/**
 * Stack profiles, as the preflop solver names them (preflop/src/game.rs, docs/stack-depths-plan.md):
 * "100", "60", "20" for equal stacks, or a base depth plus exceptions such as "100:BB20" (everyone
 * 100bb except a 20bb BB). Chart node keys carry the profile: SIX_MAX|100:BB20|RFI|UTG.
 */
export function parseProfile(id: string): Record<Position, number> | null {
  const [baseText, ...exceptions] = id.split(':');
  const base = Number(baseText);
  if (!(base >= 2)) return null;
  const stacks = Object.fromEntries(SIX_MAX_POSITIONS.map((p) => [p, base])) as Record<Position, number>;
  for (const part of exceptions) {
    const pos = SIX_MAX_POSITIONS.find((p) => part.startsWith(p) && Number(part.slice(p.length)) >= 2);
    if (!pos) return null;
    stacks[pos] = Number(part.slice(pos.length));
  }
  return stacks;
}

/** Which mixed-stack table a profile is: one shorter seat ("100:BB20"), several, or none (equal stacks). */
export function mixedKind(id: string): MixedStacks | null {
  const exceptions = id.split(':').length - 1;
  return exceptions === 0 ? null : exceptions === 1 ? 'one' : 'several';
}

/** The base depth of a profile ("100:BB20" -> 100). */
export const profileBase = (id: string) => Number(id.split(':')[0]);

/**
 * The depth whose tree and flop solves a stack plays (Tier::of in game.rs): 20bb is shove or fold,
 * 60bb is 100bb with a smaller 4-bet. A heads-up pot uses the effective (smaller) stack's depth.
 */
export const tierDepth = (stackBb: number): 20 | 60 | 100 => (stackBb <= 30 ? 20 : stackBb <= 80 ? 60 : 100);
