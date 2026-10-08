import type { ChartNodeView } from '@gtotutor/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { ACTION_COLORS, STRIPE_ORDER } from './actionColors';
import { Backdrop, Presence } from './Presence';

const DESC = 'AKQJT98765432';
export const GRID: string[][] = [...DESC].map((r1, row) =>
  [...DESC].map((r2, col) => (row === col ? r1 + r2 : col > row ? r1 + r2 + 's' : r2 + r1 + 'o')),
);
export const combos = (hc: string) => (hc.length === 2 ? 6 : hc[2] === 's' ? 4 : 12);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function RangeGrid({ nodeKey, highlight }: { nodeKey: string; highlight: string }) {
  const { data, isPending, error } = useQuery({ queryKey: ['chart', nodeKey], queryFn: () => api.chart(nodeKey) });
  const [expanded, setExpanded] = useState(false);

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
      <RangeView data={data} highlight={highlight} onGridClick={() => setExpanded(true)} />
      <Presence show={expanded}>
        <Backdrop onClose={() => setExpanded(false)}>
          <div className="range-modal" role="dialog" aria-modal aria-label={`Range chart: ${data.label}`} onClick={(e) => e.stopPropagation()}>
            <button className="ghost range-close" onClick={() => setExpanded(false)}>
              Close
            </button>
            <RangeView data={data} highlight={highlight} large />
          </div>
        </Backdrop>
      </Presence>
    </>
  );
}

function RangeView({ data, highlight, large, onGridClick }: { data: ChartNodeView; highlight: string; large?: boolean; onGridClick?: () => void }) {
  const background = (hc: string) => {
    const freqs = data.strategy[hc];
    let at = 0;
    const stops: string[] = [];
    for (const id of STRIPE_ORDER) {
      const i = data.actions.findIndex((a) => a.id === id);
      if (i < 0 || freqs[i] <= 0) continue;
      const end = at + freqs[i] * 100;
      stops.push(`${ACTION_COLORS[id]} ${at}% ${end}%`);
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

  return (
    <section className={`range ${large ? 'large' : ''}`}>
      <div
        className={`range-grid ${onGridClick ? 'clickable' : ''}`}
        role="grid"
        aria-label={`Range chart: ${data.label}`}
        onClick={onGridClick}
        title={onGridClick ? 'Click to enlarge' : undefined}
      >
        {GRID.flat().map((hc) => {
          const freqs = data.strategy[hc];
          return (
            <div
              key={hc}
              className={`cell ${hc === highlight ? 'me' : ''} ${freqs ? '' : 'out'}`}
              style={freqs ? { background: background(hc) } : undefined}
              title={freqs ? `${hc}: ${data.actions.map((a, i) => `${a.label} ${pct(freqs[i])}`).join(', ')}` : `${hc}: not in the range here`}
            >
              {/* Labels only in the enlarged view: at panel size they're unreadable, so the small grid is read by colour. */}
              {large && hc}
            </div>
          );
        })}
      </div>
      <aside className="range-side">
        <p className="range-title">{data.label}</p>
        <p className="label">Whole range</p>
        {data.actions.map((a, i) => (
          <div key={a.id} className="range-row">
            <i style={{ background: ACTION_COLORS[a.id] }} />
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
        {data.strategy[highlight] && (
          <>
            <p className="label">{data.dataSource.kind === 'solver' ? `${highlight} on average` : `Your hand (${highlight})`}</p>
            <div className="mini-bar">
              {data.actions.map((a, i) => (
                <span key={a.id} style={{ flex: data.strategy[highlight][i], background: ACTION_COLORS[a.id] }} />
              ))}
            </div>
          </>
        )}
        {onGridClick && <p className="muted small range-hint">Click the chart to enlarge</p>}
      </aside>
    </section>
  );
}
