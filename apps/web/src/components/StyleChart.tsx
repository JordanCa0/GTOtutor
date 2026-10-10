import type { PlayerStyle, StyleAxis, StyleLeakRates, StylePoint } from '@gtotutor/shared-types';
import { useEffect, useState } from 'react';
import { MaximizeIcon } from './icons';
import { Backdrop, Presence } from './Presence';

/** Below this many decisions on an axis, the point is too uncertain to read much into. */
export const STYLE_MIN_DECISIONS = 30;
/** Spot dots with fewer decisions than this don't stretch the scale; they're pinned to the edge instead. */
const SCALE_MIN_DECISIONS = 10;
/** Axis half-widths to choose from, in percentage points. */
const SCALES = [5, 10, 15, 20, 30, 40, 50, 75, 100];

/**
 * The scale fits the dots themselves (not their uncertainty ranges), so a player a few points off the
 * charts fills the chart instead of sitting in a clump at the centre. Ranges that run past it are cut
 * at the frame, and a thin spot that lands outside is pinned to the edge.
 */
function scaleFor(style: PlayerStyle): number {
  const solid = style.bySpot.filter((p) => Math.min(p.x.n || Infinity, p.y.n || Infinity) >= SCALE_MIN_DECISIONS);
  const reach = Math.max(...[style.overall, ...solid].flatMap((p) => [Math.abs(p.x.value), Math.abs(p.y.value)])) * 1.25;
  return SCALES.find((s) => s >= reach) ?? 100;
}

interface PlotProps {
  style: PlayerStyle;
  large?: boolean;
  /** The spot to emphasise (hovered in the table), or 'overall'. */
  active?: string | null;
  onActive?: (spot: string | null) => void;
}

/**
 * Where the player sits against the charts: tighter to the right, looser to the left; more aggressive
 * up, more passive down. The centre is playing like the charts.
 */
function StylePlot({ style, large, active, onActive }: PlotProps) {
  const size = large ? 520 : 360;
  const pad = 36;
  const half = (size - pad * 2) / 2;
  const mid = size / 2;
  const range = scaleFor(style);
  const clip = (v: number) => Math.max(-range, Math.min(range, v));
  // Tighter (negative x) is drawn on the right.
  const sx = (v: number) => mid - (clip(v) / range) * half;
  const sy = (v: number) => mid - (clip(v) / range) * half;
  const off = (p: StylePoint) => Math.abs(p.x.value) > range || Math.abs(p.y.value) > range;
  const { overall } = style;
  // Only the half-scale lines are numbered: end labels would sit on the frame. The full range is in the notes.
  const ticks = [-range / 2, range / 2];
  const youX = sx(overall.x.value);
  const youY = sy(overall.y.value);
  // Labels only exist in the large view. "You" is placed first so it keeps the best spot.
  const labels = large
    ? placeLabels(
        [
          { key: 'overall', x: youX, y: youY, text: 'You', gap: 16, bold: true },
          ...style.bySpot.map((p) => ({ key: p.spot, x: sx(p.x.value), y: sy(p.y.value), text: p.label, gap: 10 })),
        ],
        // The star, the corner and centre labels, and the axis numbers are in the way too.
        [
          { left: youX - 15, right: youX + 15, top: youY - 15, bottom: youY + 15 },
          { left: pad, right: pad + 112, top: pad, bottom: pad + 24 },
          { left: size - pad - 112, right: size - pad, top: pad, bottom: pad + 24 },
          { left: pad, right: pad + 100, top: size - pad - 24, bottom: size - pad },
          { left: size - pad - 100, right: size - pad, top: size - pad - 24, bottom: size - pad },
          { left: mid - 50, right: mid, top: size - pad - 24, bottom: size - pad },
          ...ticks.flatMap((t) => [
            { left: sx(t) - 12, right: sx(t) + 12, top: mid + 3, bottom: mid + 18 },
            { left: mid - 30, right: mid - 4, top: sy(t) - 8, bottom: sy(t) + 7 },
          ]),
        ],
        { left: pad + 4, right: size - pad - 4, top: pad + 4, bottom: size - pad - 4 },
        mid,
      )
    : new Map<string, Placed>();

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={large ? 'style-plot large' : 'style-plot'} role="img" aria-label={`You: ${describe(overall)}`}>
      <rect className="style-frame" x={pad} y={pad} width={size - pad * 2} height={size - pad * 2} rx={8} />
      {/* Half-scale grid lines: enough to judge distance without crowding the dots. */}
      {[-range / 2, range / 2].map((t) => (
        <g key={t} className="style-grid">
          <line x1={sx(t)} x2={sx(t)} y1={pad} y2={size - pad} />
          <line y1={sy(t)} y2={sy(t)} x1={pad} x2={size - pad} />
        </g>
      ))}
      <line className="style-axis" x1={pad} x2={size - pad} y1={mid} y2={mid} />
      <line className="style-axis" y1={pad} y2={size - pad} x1={mid} x2={mid} />
      {large &&
        ticks.map((t) => (
          <g key={t} className="style-tick">
            <text x={sx(t)} y={mid + 14} textAnchor="middle">
              {Math.abs(t)}
            </text>
            <text x={mid - 6} y={sy(t) + 4} textAnchor="end">
              {Math.abs(t)}
            </text>
          </g>
        ))}

      <text className="style-quadrant" x={pad + 10} y={pad + 18}>
        Loose-aggressive
      </text>
      <text className="style-quadrant" x={size - pad - 10} y={pad + 18} textAnchor="end">
        Tight-aggressive
      </text>
      <text className="style-quadrant" x={pad + 10} y={size - pad - 10}>
        Loose-passive
      </text>
      <text className="style-quadrant" x={size - pad - 10} y={size - pad - 10} textAnchor="end">
        Tight-passive
      </text>
      <text className="style-edge" x={mid} y={pad - 12} textAnchor="middle">
        More aggressive
      </text>
      <text className="style-edge" x={mid} y={size - 12} textAnchor="middle">
        More passive
      </text>
      <text className="style-edge" x={14} y={mid} textAnchor="middle" transform={`rotate(-90 14 ${mid})`}>
        Looser
      </text>
      <text className="style-edge" x={size - 14} y={mid} textAnchor="middle" transform={`rotate(90 ${size - 14} ${mid})`}>
        Tighter
      </text>
      <text className="style-centre" x={mid - 6} y={size - pad - 10} textAnchor="end">
        Charts
      </text>

      {style.bySpot.map((p) => {
        const x = sx(p.x.value);
        const y = sy(p.y.value);
        const on = active === p.spot;
        const label = labels.get(p.spot);
        return (
          <g
            key={p.spot}
            className={`style-spot ${on ? 'on' : ''} ${off(p) ? 'off' : ''} ${thin(p) ? 'thin' : ''}`}
            onPointerEnter={() => onActive?.(p.spot)}
            onPointerLeave={() => onActive?.(null)}
          >
            {label && <LabelText label={label} text={p.label} />}
            <circle cx={x} cy={y} r={on ? 7 : large ? 5.5 : 4.5} />
            <title>{`${p.label}: ${describe(p)}`}</title>
          </g>
        );
      })}

      <g className={`style-player ${active === 'overall' ? 'on' : ''}`} onPointerEnter={() => onActive?.('overall')} onPointerLeave={() => onActive?.(null)}>
        <polygon points={starPoints(youX, youY, large ? 14 : 12)} />
        {labels.get('overall') && <LabelText label={labels.get('overall')!} text="You" className="style-you" />}
        <title>{`You: ${describe(overall)}`}</title>
      </g>
    </svg>
  );
}

/** Profile card: the chart (click to expand) beside a plain-words reading of it. */
export function StyleCard({ style }: { style: PlayerStyle }) {
  const [open, setOpen] = useState(false);
  const { overall } = style;
  const few = overall.x.n < STYLE_MIN_DECISIONS || overall.y.n < STYLE_MIN_DECISIONS;
  const outliers = [...style.bySpot]
    .filter((p) => !thin(p))
    .sort((a, b) => distance(b) - distance(a))
    .slice(0, 2)
    .filter((p) => distance(p) >= 3);

  return (
    <div className="style-card">
      <button className="style-open" onClick={() => setOpen(true)} aria-label="Expand your playing style chart">
        <StylePlot style={style} />
        <span className="style-open-hint">
          <MaximizeIcon size={14} /> Expand
        </span>
      </button>
      <div className="style-reading">
        <p className="style-headline">{headline(overall)}</p>
        <p className="muted small">
          Compared with what the charts do in the same spots, over {overall.x.n} decisions where you could fold and {overall.y.n} where you could bet or raise.
          {few && ` That's still a small sample, so treat it as a rough guess for now.`}
        </p>
        <LeakLines leaks={style.leaks} />
        {outliers.length > 0 && (
          <>
            <p className="label">Furthest from the charts</p>
            <ul className="style-outliers">
              {outliers.map((p) => (
                <li key={p.spot}>
                  <strong>{p.label}</strong>
                  <span className="muted">{describeShort(p)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <button className="ghost" onClick={() => setOpen(true)}>
          See every spot
        </button>
      </div>
      <Presence show={open}>
        <StyleDetail style={style} onClose={() => setOpen(false)} />
      </Presence>
    </div>
  );
}

/** Expanded view: a large labelled chart and a row per spot; hovering either highlights the other. */
function StyleDetail({ style, onClose }: { style: PlayerStyle; onClose: () => void }) {
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Don't also close the profile page underneath.
      e.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const rows = [{ spot: 'overall', label: 'All decisions', ...style.overall }, ...[...style.bySpot].sort((a, b) => b.x.n + b.y.n - (a.x.n + a.y.n))];

  return (
    <Backdrop onClose={onClose}>
      <div className="modal style-detail" role="dialog" aria-modal="true" aria-label="Your playing style" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Your playing style</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="style-detail-body">
          <StylePlot style={style} large active={active} onActive={setActive} />
          <div className="style-detail-side">
            <p className="style-headline">{headline(style.overall)}</p>
            <LeakLines leaks={style.leaks} />
            <table className="spot-table style-table">
              <thead>
                <tr>
                  <th>Spot</th>
                  <th>
                    Continue <span className="style-th-sub">you / charts</span>
                  </th>
                  <th>
                    Bet or raise <span className="style-th-sub">you / charts</span>
                  </th>
                  <th>Decisions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.spot} className={active === r.spot ? 'on' : ''} onPointerEnter={() => setActive(r.spot)} onPointerLeave={() => setActive(null)}>
                    <td>
                      {r.label}
                      {thin(r) && <span className="style-thin"> few hands</span>}
                    </td>
                    <td>
                      <RatePair axis={r.x} />
                    </td>
                    <td>
                      <RatePair axis={r.y} />
                    </td>
                    <td>{Math.max(r.x.n, r.y.n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="style-explain muted small">
              <p>
                <strong>Continue:</strong> in spots where you could fold, how often you played on (called, bet or raised), next to how often the charts do in the same spots. The gap is how far left (looser) or right (tighter) a dot sits.
              </p>
              <p>
                <strong>Bet or raise:</strong> in spots where you could bet or raise, how often you did, next to the charts. The gap is how far up (more aggressive) or down a dot sits.
              </p>
              <p>
                The gold star is all your decisions together; blue dots are single spot types, hollow when there are too few hands to trust yet. Each axis on the chart runs to {scaleFor(style)} percentage points either side.
              </p>
            </div>
          </div>
        </div>
      </div>
    </Backdrop>
  );
}

/** Your rate in bold next to the charts' rate: "34% / 28%". */
function RatePair({ axis }: { axis: StyleAxis }) {
  if (!axis.n) return <span className="muted">–</span>;
  return (
    <span className="style-rates">
      <b>{Math.round(axis.you)}%</b>
      <span className="muted"> / {Math.round(axis.chart)}%</span>
    </span>
  );
}

/** Below this much chart weight (in hands), a leak rate is mostly noise, so it isn't shown. */
const LEAK_MIN_WEIGHT = 5;

/** The two directions behind left/right: hands played that the charts fold, and folded that they play. */
function LeakLines({ leaks }: { leaks: StyleLeakRates }) {
  const rows = [
    { key: 'loose', label: 'Played hands the charts fold', ...leaks.playedChartFolds },
    { key: 'tight', label: 'Folded hands the charts play', ...leaks.foldedChartPlays },
  ].filter((r) => r.weight >= LEAK_MIN_WEIGHT);
  if (!rows.length) return null;
  return (
    <ul className="style-leaks">
      {rows.map((r) => (
        <li key={r.key}>
          <span>{r.label}</span>
          <b>{Math.round(r.rate)}%</b>
        </li>
      ))}
    </ul>
  );
}

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Where a label landed: its text position, and a line back to its dot if it had to move. */
interface Placed {
  x: number;
  y: number;
  anchor: 'start' | 'end';
  leader: { x1: number; y1: number; x2: number; y2: number } | null;
}

/** Vertical step between label rows, in chart units (the labels are 12px). */
const LABEL_ROW = 15;

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Puts each label beside its dot without overlapping earlier labels, the dots, or the frame. Each one
 * tries its natural spot first (the side away from the centre line), then the other side, then rows
 * further up and down. Labels placed earlier win, so the most important go first.
 */
function placeLabels(
  items: { key: string; x: number; y: number; text: string; gap: number; bold?: boolean }[],
  obstacles: Box[],
  bounds: Box,
  mid: number,
): Map<string, Placed> {
  // Every dot is in the way of every label but its own (which sits outside its own label anyway).
  const taken: Box[] = [...obstacles, ...items.map((it) => ({ left: it.x - 9, right: it.x + 9, top: it.y - 9, bottom: it.y + 9 }))];
  const out = new Map<string, Placed>();
  const shifts = Array.from({ length: 17 }, (_, i) => (i % 2 ? -1 : 1) * Math.ceil(i / 2) * LABEL_ROW);
  for (const it of items) {
    // Rough text width for 12px Inter; a little generous so neighbours don't touch.
    const width = it.text.length * (it.bold ? 7.4 : 6.8);
    const sides = it.x <= mid ? [1, -1] : [-1, 1];
    const boxFor = (side: number, cy: number): Box => {
      const left = side > 0 ? it.x + it.gap : it.x - it.gap - width;
      return { left, right: left + width, top: cy - 8, bottom: cy + 7 };
    };
    const inside = (b: Box) => b.left >= bounds.left && b.right <= bounds.right && b.top >= bounds.top && b.bottom <= bounds.bottom;
    // Score every spot in the frame: collisions cost the most, then distance from the dot, then the
    // less natural side. On a very crowded chart this still picks the spot that overlaps least.
    let found: { side: number; cy: number; box: Box; cost: number } | null = null;
    for (const dy of shifts) {
      for (const side of sides) {
        const box = boxFor(side, it.y + dy);
        if (!inside(box)) continue;
        const cost = taken.filter((t) => overlaps(t, box)).length * 1000 + Math.abs(dy) + (side === sides[0] ? 0 : 6);
        if (!found || cost < found.cost) found = { side, cy: it.y + dy, box, cost };
      }
    }
    // Only possible for a label wider than the frame: keep the natural spot.
    if (!found) found = { side: sides[0], cy: it.y, box: boxFor(sides[0], it.y), cost: 0 };
    taken.push(found.box);
    const { side, cy, box } = found;
    out.set(it.key, {
      x: side > 0 ? box.left : box.right,
      y: cy + 4,
      anchor: side > 0 ? 'start' : 'end',
      leader: Math.abs(cy - it.y) > 1 ? { x1: it.x + side * 6, y1: it.y, x2: side > 0 ? box.left - 3 : box.right + 3, y2: cy } : null,
    });
  }
  return out;
}

function LabelText({ label, text, className }: { label: Placed; text: string; className?: string }) {
  return (
    <>
      {label.leader && <line className="style-leader" {...label.leader} />}
      <text x={label.x} y={label.y} textAnchor={label.anchor} className={className}>
        {text}
      </text>
    </>
  );
}

/** A five-pointed star centred on (cx, cy), point up, as an SVG polygon's `points`. */
function starPoints(cx: number, cy: number, outer: number): string {
  const inner = outer * 0.45;
  return Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
}

const thin = (p: StylePoint) => Math.max(p.x.n, p.y.n) < STYLE_MIN_DECISIONS;
const distance = (p: StylePoint) => Math.hypot(p.x.value, p.y.value);

/** "continue 52% vs 41%", or null when the axis has no decisions. */
function axisText(a: StyleAxis, what: string): string | null {
  return a.n ? `${what} ${Math.round(a.you)}% vs ${Math.round(a.chart)}%` : null;
}

/** "Continue 52% vs 41%, raise 6% vs 14%": yours first, then the charts'. */
function describeShort(p: StylePoint): string {
  const text = [axisText(p.x, 'continue'), axisText(p.y, 'raise')].filter(Boolean).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** For tooltips: "Continue 52% vs 41%, raise 6% vs 14% (54 and 54 decisions)". */
function describe(p: StylePoint): string {
  return `${describeShort(p)} (${p.x.n} and ${p.y.n} decisions)`;
}

/** One sentence for the card: "You play looser and more passive than the charts." */
function headline(p: StylePoint): string {
  const loose = Math.abs(p.x.value) < 2 ? null : p.x.value > 0 ? 'looser' : 'tighter';
  const aggr = Math.abs(p.y.value) < 2 ? null : p.y.value > 0 ? 'more aggressive' : 'more passive';
  if (!loose && !aggr) return 'You play close to the charts.';
  return `You play ${[loose, aggr].filter(Boolean).join(' and ')} than the charts.`;
}
