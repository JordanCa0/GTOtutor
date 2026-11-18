import type { TrackedSession } from '@gtotutor/shared-types';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** Plot geometry in px: the chart is drawn at its measured width so text and lines stay crisp. */
const HEIGHT = 220;
const PAD = { top: 16, bottom: 28, left: 56 };

interface Point {
  /** Running total after this session (0 for the starting point). */
  total: number;
  session: TrackedSession | null;
}

/** Up to about `count` round tick values covering [min, max], always including 0. */
function niceTicks(min: number, max: number, count = 4): number[] {
  const lo = Math.min(min, 0);
  const hi = Math.max(max, 0);
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) ticks.push(Math.round(v * 100) / 100);
  if (ticks.at(-1)! < hi) ticks.push(ticks.at(-1)! + step);
  return ticks;
}

const compact = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const bbWhole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const bbCompact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

export type ChartUnit = 'usd' | 'bb';

/** Axis labels: in full under 10,000, compact from there ($12K, 12K bb); one style per axis. */
const axisLabel = (n: number, big: boolean, unit: ChartUnit) =>
  (n < 0 ? '−' : '') + (unit === 'usd' ? (big ? compact : whole).format(Math.abs(n)) : `${(big ? bbCompact : bbWhole).format(Math.abs(n))} bb`);

function shortDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * The tracker's trend: the running total of results, one step per session in date order, starting from $0
 * at the start of the chosen timeframe. A single series (no legend: the heading names it), with a crosshair
 * tooltip on hover and arrow keys. Every value is also in the session list below it.
 */
export function TrackerChart({
  sessions,
  value,
  signed,
  unit,
}: {
  sessions: TrackedSession[];
  /** What each session adds to the total: its result in dollars, or in big blinds. */
  value: (s: TrackedSession) => number;
  signed: (n: number) => string;
  unit: ChartUnit;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);

  // Oldest first; same-day sessions in the order they were logged.
  const points = useMemo<Point[]>(() => {
    const ordered = [...sessions].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    let total = 0;
    return [{ total: 0, session: null }, ...ordered.map((s) => ({ total: (total = Math.round((total + value(s)) * 100) / 100), session: s }))];
  }, [sessions, value]);

  // A filter change can leave the highlighted point out of range.
  useEffect(() => setActive(null), [points]);

  const totals = points.map((p) => p.total);
  const ticks = niceTicks(Math.min(...totals), Math.max(...totals));
  const yMin = ticks[0];
  const yMax = ticks.at(-1)!;
  const big = Math.max(Math.abs(yMin), Math.abs(yMax)) >= 10_000;
  const end = points.at(-1)!;
  // Room on the right for the end label: about 8px a character at 14px semibold, plus the gap from its dot.
  const padRight = 20 + signed(end.total).length * 8;
  const plotW = Math.max(0, width - PAD.left - padRight);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length === 1 ? 0 : (i / (points.length - 1)) * plotW);
  const y = (v: number) => PAD.top + ((yMax - v) / (yMax - yMin || 1)) * plotH;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join('');
  const area = `${line}L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)}L${x(0).toFixed(1)},${y(0).toFixed(1)}Z`;

  // Date labels under a few evenly spread sessions (skipping the starting point), never overlapping.
  const maxLabels = Math.max(2, Math.floor(plotW / 90));
  const sessionIdx = points.map((_, i) => i).slice(1);
  const step = Math.max(1, Math.ceil(sessionIdx.length / maxLabels));
  const dateTicks = sessionIdx.filter((_, k) => k % step === 0 || k === sessionIdx.length - 1).filter((i, k, arr) => k === arr.length - 1 || arr[arr.length - 1] - i >= step * 0.6);

  const last = points.length - 1;
  const pick = (e: PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const rel = (e.clientX - box.left) / (box.width || 1);
    setActive(Math.min(last, Math.max(0, Math.round(rel * last))));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const d = e.key === 'ArrowRight' ? 1 : -1;
      setActive((a) => Math.min(last, Math.max(0, (a ?? (d > 0 ? -1 : last + 1)) + d)));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : last);
    } else if (e.key === 'Escape') setActive(null);
  };

  const a = active === null ? null : points[active];
  const describe = `Running total over ${last} session${last === 1 ? '' : 's'}, ending at ${signed(end.total)}. Use the arrow keys to step through sessions.`;

  return (
    <div className="tracker-chart" ref={wrap}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label={describe} tabIndex={0} onKeyDown={onKey} onBlur={() => setActive(null)}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? 'tc-zero' : 'tc-grid'} x1={PAD.left} x2={width - padRight} y1={y(t)} y2={y(t)} />
              <text className="tc-axis" x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {axisLabel(t, big, unit)}
              </text>
            </g>
          ))}
          {dateTicks.map((i) => (
            <text key={i} className="tc-axis" x={x(i)} y={HEIGHT - 8} textAnchor={i === last && dateTicks.length > 1 ? 'end' : 'middle'}>
              {shortDate(points[i].session!.date)}
            </text>
          ))}
          <path className="tc-area" d={area} />
          <path className="tc-line" d={line} />
          {/* The end value, labelled in text ink beside its dot. */}
          <circle className="tc-dot" cx={x(last)} cy={y(end.total)} r={4} />
          <text className="tc-end" x={x(last) + 10} y={y(end.total)} dy="0.32em">
            {signed(end.total)}
          </text>
          {a && active !== null && (
            <g className="tc-cursor" aria-hidden>
              <line x1={x(active)} x2={x(active)} y1={PAD.top} y2={PAD.top + plotH} />
              <circle className="tc-dot" cx={x(active)} cy={y(a.total)} r={5} />
            </g>
          )}
          {/* The hit area is the whole plot: the crosshair snaps to the nearest session. */}
          <rect className="tc-hit" x={PAD.left - 8} y={0} width={plotW + 16} height={HEIGHT} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setActive(null)} />
        </svg>
      )}
      {a && active !== null && (
        <div
          className="tc-tip"
          role="status"
          style={{ left: Math.min(Math.max(x(active), 90), width - 90), top: Math.max(0, y(a.total) - 12) }}
        >
          <strong>{signed(a.total)}</strong>
          {a.session ? (
            <>
              <span className="muted">
                {shortDate(a.session.date)} · {a.session.location}
              </span>
              <span className="muted">This session {signed(value(a.session))}</span>
            </>
          ) : (
            <span className="muted">Start of the period</span>
          )}
        </div>
      )}
    </div>
  );
}
