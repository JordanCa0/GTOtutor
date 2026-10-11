import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

/** Wait this long before showing a skeleton, so fast or cached answers never flash one. */
const SHOW_AFTER_MS = 150;
/** Once shown, keep a skeleton at least this long, so it doesn't flicker. */
const SHOW_AT_LEAST_MS = 300;

type Phase = 'wait' | 'show' | 'done';

/**
 * Whether to render the skeleton while `pending`: true (but invisible) for the first 150 ms, then
 * visible, and kept for at least 300 ms once seen. `visible` says whether it can be seen yet.
 */
export function useSkeleton(pending: boolean): { active: boolean; visible: boolean } {
  const [phase, setPhase] = useState<Phase>(pending ? 'wait' : 'done');
  const shownAt = useRef(0);

  useEffect(() => {
    if (pending) {
      if (phase === 'done') setPhase('wait');
      if (phase !== 'wait') return;
      const t = setTimeout(() => {
        shownAt.current = performance.now();
        setPhase('show');
      }, SHOW_AFTER_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'wait') return setPhase('done');
    if (phase === 'show') {
      const t = setTimeout(() => setPhase('done'), Math.max(0, SHOW_AT_LEAST_MS - (performance.now() - shownAt.current)));
      return () => clearTimeout(t);
    }
  }, [pending, phase]);

  return { active: phase !== 'done' || pending, visible: phase === 'show' };
}

interface SkeletonProps {
  kind?: 'line' | 'block' | 'circle';
  width?: CSSProperties['width'];
  height?: CSSProperties['height'];
  className?: string;
  style?: CSSProperties;
}

/** A grey placeholder shape in a real component's size, with a slow shimmer. */
export function Skeleton({ kind = 'line', width, height, className = '', style }: SkeletonProps) {
  return <span className={`skeleton skeleton-${kind} ${className}`} style={{ width, height, ...style }} aria-hidden />;
}

/** Wraps a page's skeleton: hidden for the first moments, labelled for screen readers. */
export function SkeletonGroup({ visible, label, className = '', children }: { visible: boolean; label: string; className?: string; children: ReactNode }) {
  return (
    <div className={`skeleton-group ${visible ? '' : 'skeleton-wait'} ${className}`} role="status" aria-label={label}>
      {children}
    </div>
  );
}

/** The 13x13 range chart's shape: the grid and a few legend lines. */
export function RangeSkeleton({ small = false }: { small?: boolean }) {
  return (
    <div className={small ? 'villain-range' : 'range range-skeleton'}>
      <span className="range-grid skeleton-grid" aria-hidden>
        {Array.from({ length: 169 }, (_, i) => (
          <span key={i} className="skeleton skeleton-cell" />
        ))}
      </span>
      <span className="range-side">
        <Skeleton width="70%" height="1.1em" />
        {[60, 80, 50].map((w) => (
          <Skeleton key={w} width={`${w}%`} style={{ marginTop: 'var(--sp-2)' }} />
        ))}
      </span>
    </div>
  );
}
