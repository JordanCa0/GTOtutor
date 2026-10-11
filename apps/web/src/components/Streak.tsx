import type { StreakUpdate } from '@gtotutor/shared-types';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

/**
 * The run of good decisions as a multiplier ("×7"), from 2 up. It pops each time the run grows
 * (keyed on the count, so the entrance animation replays) and glows at milestones. When a mistake
 * ends the run it simply goes away: no "streak lost" message.
 */
export function StreakBadge({ streak }: { streak: StreakUpdate | null }) {
  if (!streak || streak.count < 2) return null;
  return (
    <div className="streak" role="status" aria-label={`Streak: ${streak.count} good decisions in a row`}>
      <span key={streak.count} className={`streak-badge ${streak.milestone ? 'milestone' : ''}`} aria-hidden>
        <span className="streak-x">×</span>
        {streak.count}
      </span>
      <span className="streak-label muted small" aria-hidden>
        in a row
      </span>
    </div>
  );
}

/** A milestone to celebrate, and when it happened (a remounted table picks the shower up where it was). */
export interface Celebration {
  milestone: number;
  at: number;
}

const SHOWER_MS = 3600;

/** Chip colours by tier: the usual colours at 5, more gold as milestones climb, all gold with a shine from 25. */
const CHIPS = [
  { chip: '#b3261e', stripe: '#f4efe2' },
  { chip: '#1f7a4d', stripe: '#f4efe2' },
  { chip: '#16181d', stripe: '#d4af37' },
  { chip: '#2d5aa0', stripe: '#e9e4d8' },
];
const GOLD = { chip: '#d4af6a', stripe: '#fff3cf' };

function tierOf(milestone: number) {
  if (milestone >= 25) return { count: 44, gold: 1, shine: true };
  if (milestone >= 15) return { count: 34, gold: 0.7, shine: false };
  if (milestone >= 10) return { count: 26, gold: 0.3, shine: false };
  return { count: 18, gold: 0, shine: false };
}

/**
 * A shower of chips behind the seats when a streak hits a milestone (5, 10, 15…), about 3 seconds.
 * Only transform and opacity animate. Left out with reduced motion, or with animations or
 * celebrations turned off (the caller checks the settings).
 */
export function ChipRain({ celebration }: { celebration: Celebration }) {
  const elapsed = Date.now() - celebration.at;
  const [done, setDone] = useState(elapsed >= SHOWER_MS);
  useEffect(() => {
    if (done) return;
    const t = setTimeout(() => setDone(true), SHOWER_MS - elapsed);
    return () => clearTimeout(t);
  }, [done, elapsed]);

  const chips = useMemo(() => {
    const tier = tierOf(celebration.milestone);
    // Seeded by the milestone time, so a remount draws the same shower.
    let seed = celebration.at % 2147483647 || 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: tier.count }, () => {
      const colors = rand() < tier.gold ? GOLD : CHIPS[Math.floor(rand() * CHIPS.length)];
      return {
        style: {
          left: `${rand() * 96}%`,
          ['--chip' as string]: colors.chip,
          ['--stripe' as string]: colors.stripe,
          ['--size' as string]: `${18 + rand() * 14}px`,
          ['--drift' as string]: `${(rand() - 0.5) * 16}cqw`,
          ['--spin' as string]: `${(rand() - 0.5) * 900}deg`,
          animationDuration: `${1700 + rand() * 900}ms`,
          // Negative once the shower is under way, so a remount continues it rather than starting over.
          animationDelay: `${Math.round(rand() * 900) - elapsed}ms`,
        } as CSSProperties,
        shine: tier.shine,
      };
    });
    // Drawn once per celebration.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebration.at, celebration.milestone]);

  if (done) return null;
  return (
    <div className="chip-rain" aria-hidden>
      {chips.map((c, i) => (
        <i key={i} className={c.shine ? 'shine' : undefined} style={c.style} />
      ))}
    </div>
  );
}
