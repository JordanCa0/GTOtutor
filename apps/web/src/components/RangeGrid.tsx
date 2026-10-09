import type { ChartNodeView } from '@gtotutor/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { api } from '../api/client';
import { ACTION_COLORS, optionColor, stripeOrder } from './actionColors';
import { Backdrop, Presence } from './Presence';

const DESC = 'AKQJT98765432';
export const GRID: string[][] = [...DESC].map((r1, row) =>
  [...DESC].map((r2, col) => (row === col ? r1 + r2 : col > row ? r1 + r2 + 's' : r2 + r1 + 'o')),
);
export const combos = (hc: string) => (hc.length === 2 ? 6 : hc[2] === 's' ? 4 : 12);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const kind = (hc: string) => (hc.length === 2 ? 'pair' : hc[2] === 's' ? 'suited' : 'offsuit');

export function RangeGrid({ nodeKey, highlight }: { nodeKey: string; highlight: string }) {
  const { data, isPending, error } = useQuery({ queryKey: ['chart', nodeKey], queryFn: () => api.chart(nodeKey) });
  const [expanded, setExpanded] = useState(false);
  // The hand shown in the enlarged view's side panel; opens on the hero's hand each time.
  const [selected, setSelected] = useState(highlight);
  const open = () => {
    setSelected(highlight);
    setExpanded(true);
  };

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setExpanded(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  if (isPending) return <div className="range placeholder" />;
  if (error) return <p className="error small">{error.message}</p>;

  return (
    <>
      <RangeView data={data} highlight={highlight} onGridClick={open} />
      <Presence show={expanded}>
        <Backdrop onClose={() => setExpanded(false)}>
          <div className="range-modal" role="dialog" aria-modal aria-label={`Range chart: ${data.label}`} onClick={(e) => e.stopPropagation()}>
            <button className="ghost range-close" onClick={() => setExpanded(false)}>
              Close
            </button>
            <RangeView data={data} highlight={highlight} large selected={selected} onSelect={setSelected} />
          </div>
        </Backdrop>
      </Presence>
    </>
  );
}

interface RangeViewProps {
  data: ChartNodeView;
  highlight: string;
  large?: boolean;
  onGridClick?: () => void;
  /** Enlarged view only: the hand whose numbers the side panel shows, and how to change it. */
  selected?: string;
  onSelect?: (hc: string) => void;
}

function RangeView({ data, highlight, large, onGridClick, selected, onSelect }: RangeViewProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const shown = hovered ?? selected;
  const background = (hc: string) => {
    const freqs = data.strategy[hc];
    let at = 0;
    const stops: string[] = [];
    for (const i of stripeOrder(data.actions)) {
      if (freqs[i] <= 0) continue;
      const end = at + freqs[i] * 100;
      stops.push(`${optionColor(data.actions, i)} ${at}% ${end}%`);
      at = end;
    }
    return stops.length ? `linear-gradient(to right, ${stops.join(', ')})` : ACTION_COLORS.fold;
  };

  const totals = data.actions.map(() => 0);
  let all = 0;
  let outOfRange = 0;
  for (const hc of GRID.flat()) {
    // Postflop, hands that never reach this spot (folded or raised earlier) have no strategy.
    if (!data.strategy[hc]) {
      outOfRange++;
      continue;
    }
    all += combos(hc);
    data.strategy[hc].forEach((f, i) => (totals[i] += f * combos(hc)));
  }

  const describe = (hc: string) => {
    const freqs = data.strategy[hc];
    return freqs ? `${hc}: ${data.actions.map((a, i) => `${a.label} ${pct(freqs[i])}`).join(', ')}` : `${hc}: not in the range here`;
  };

  // Arrow keys move the selection around the grid; focus follows it (one tab stop for the whole grid).
  const gridRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!onSelect || !selected) return;
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!step) return;
    e.preventDefault();
    const at = GRID.flat().indexOf(selected);
    const row = Math.min(12, Math.max(0, Math.floor(at / 13) + step[0]));
    const col = Math.min(12, Math.max(0, (at % 13) + step[1]));
    onSelect(GRID[row][col]);
    gridRef.current?.querySelectorAll<HTMLElement>('.cell')[row * 13 + col]?.focus();
  };

  return (
    <section className={`range ${large ? 'large' : ''}`}>
      <div
        ref={gridRef}
        className={`range-grid ${onGridClick ? 'clickable' : ''} ${onSelect ? 'selectable' : ''}`}
        role="grid"
        aria-label={`Range chart: ${data.label}`}
        onClick={onGridClick}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setHovered(null)}
        title={onGridClick ? 'Click to enlarge' : undefined}
      >
        {GRID.flat().map((hc) => {
          const freqs = data.strategy[hc];
          const className = `cell ${hc === highlight ? 'me' : ''} ${hc === selected ? 'picked' : ''} ${freqs ? '' : 'out'}`;
          const style = freqs ? { background: background(hc) } : undefined;
          // Labels only in the enlarged view: at panel size they're unreadable, so the small grid is read by colour.
          if (!onSelect)
            return (
              <div key={hc} className={className} style={style} title={describe(hc)}>
                {large && hc}
              </div>
            );
          return (
            <button
              key={hc}
              type="button"
              role="gridcell"
              className={className}
              style={style}
              aria-label={describe(hc)}
              aria-selected={hc === selected}
              tabIndex={hc === selected ? 0 : -1}
              onClick={(e) => {
                onSelect(hc);
                // Safari doesn't focus buttons on click; the arrow keys need focus inside the grid.
                e.currentTarget.focus();
              }}
              onMouseEnter={() => setHovered(hc)}
            >
              {hc}
            </button>
          );
        })}
      </div>
      <aside className="range-side">
        <p className="range-title">{data.label}</p>
        <p className="label">Whole range</p>
        {data.actions.map((a, i) => (
          <div key={i} className="range-row">
            <i style={{ background: optionColor(data.actions, i) }} />
            <span>{a.label}</span>
            <b>{pct(totals[i] / (all || 1))}</b>
          </div>
        ))}
        {outOfRange > 0 && (
          <div className="range-row muted">
            <i className="out-swatch" />
            <span>Not in range here</span>
          </div>
        )}
        {shown && onSelect ? (
          <HandDetail data={data} hc={shown} isHero={shown === highlight} onBack={selected !== highlight ? () => onSelect(highlight) : undefined} />
        ) : (
          data.strategy[highlight] && (
            <>
              <p className="label">{data.dataSource.kind === 'solver' ? `${highlight} on average` : `Your hand (${highlight})`}</p>
              <div className="mini-bar">
                {data.actions.map((a, i) => (
                  <span key={i} style={{ flex: data.strategy[highlight][i], background: optionColor(data.actions, i) }} />
                ))}
              </div>
            </>
          )
        )}
        {onGridClick && <p className="muted small range-hint">Click the chart to enlarge and explore any hand</p>}
        {onSelect && <p className="muted small range-hint">Click any hand to see its numbers</p>}
      </aside>
    </section>
  );
}

/** Enlarged view's side panel: one hand's strategy, for any hand on the grid. */
function HandDetail({ data, hc, isHero, onBack }: { data: ChartNodeView; hc: string; isHero: boolean; onBack?: () => void }) {
  const freqs = data.strategy[hc];
  return (
    <div className="hand-detail" aria-live="polite">
      <p className="label">
        {isHero ? 'Your hand' : 'Selected hand'}
        {onBack && (
          <>
            {' · '}
            <button className="link" onClick={onBack}>
              Back to your hand
            </button>
          </>
        )}
      </p>
      <p className="detail-hand">
        {hc} <span className="muted">
          {kind(hc)}, {combos(hc)} combos
        </span>
      </p>
      {freqs ? (
        <>
          <div className="mini-bar">
            {data.actions.map((a, i) => (
              <span key={i} style={{ flex: freqs[i], background: optionColor(data.actions, i) }} />
            ))}
          </div>
          {data.actions.map((a, i) => (
            <div key={i} className="range-row">
              <i style={{ background: optionColor(data.actions, i) }} />
              <span>{a.label}</span>
              <b>{pct(freqs[i])}</b>
            </div>
          ))}
          {data.dataSource.kind === 'solver' && <p className="muted small">Averaged over the hand's combos.</p>}
        </>
      ) : (
        <p className="muted small">Not in the range here: this hand folded or took another line earlier.</p>
      )}
    </div>
  );
}
