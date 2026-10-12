import type { ReactNode } from 'react';

/** Which way a recent number moved against the all-time one: better, worse, or about the same. */
export type TrendDirection = 'better' | 'worse' | 'same';

/**
 * `higherIsBetter` says which way is good; moves of `noise` or less count as the same, so a small
 * recent sample doesn't flash green or red on luck alone.
 */
export function trendOf(all: number, recent: number, higherIsBetter: boolean, noise: number): TrendDirection {
  const gain = (recent - all) * (higherIsBetter ? 1 : -1);
  return gain > noise ? 'better' : gain < -noise ? 'worse' : 'same';
}

/**
 * How far a share (0–1, or 0–100 with `scale` 100) over `n` recent decisions can wander by luck:
 * two standard errors, at least `floor`.
 */
export function shareNoise(p: number, n: number, floor: number, scale = 1): number {
  const q = Math.min(1, Math.max(0, p / scale));
  return Math.max(floor, 2 * scale * Math.sqrt((q * (1 - q)) / Math.max(1, n)));
}

const SPOKEN: Record<TrendDirection, string> = { better: 'better than all-time', worse: 'worse than all-time', same: 'about the same as all-time' };

/**
 * A recent number beside the all-time one. The arrow says which way the number moved (▲ up, ▼ down),
 * the colour whether that's good (green) or bad (red), since for some numbers lower is better.
 */
export function Trend({ direction, all, recent, children, title }: { direction: TrendDirection; all: number; recent: number; children: ReactNode; title?: string }) {
  const arrow = direction === 'same' ? '•' : recent > all ? '▲' : '▼';
  return (
    <span className={`trend trend-${direction}`} title={title}>
      <span aria-hidden>{arrow}</span> {children}
      <span className="sr-only">, {SPOKEN[direction]}</span>
    </span>
  );
}
