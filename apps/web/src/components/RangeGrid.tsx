import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { ACTION_COLORS, STRIPE_ORDER } from './actionColors';

const DESC = 'AKQJT98765432';
const GRID: string[][] = [...DESC].map((r1, row) =>
  [...DESC].map((r2, col) => (row === col ? r1 + r2 : col > row ? r1 + r2 + 's' : r2 + r1 + 'o')),
);

export function RangeGrid({ nodeKey, highlight }: { nodeKey: string; highlight: string }) {
  const { data, isPending, error } = useQuery({ queryKey: ['chart', nodeKey], queryFn: () => api.chart(nodeKey) });
  if (isPending) return <p className="muted small">Loading range…</p>;
  if (error) return <p className="error small">{error.message}</p>;

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

  return (
    <div>
      <div className="range-grid" role="grid" aria-label={`Range chart: ${data.label}`}>
        {GRID.flat().map((hc) => (
          <div key={hc} className={`cell ${hc === highlight ? 'me' : ''}`} style={{ background: background(hc) }} title={`${hc}: ${data.actions.map((a, i) => `${a.label} ${Math.round(data.strategy[hc][i] * 100)}%`).join(', ')}`}>
            {hc}
          </div>
        ))}
      </div>
      <div className="legend">
        {data.actions.map((a) => (
          <span key={a.id}>
            <i style={{ background: ACTION_COLORS[a.id] }} /> {a.label}
          </span>
        ))}
      </div>
    </div>
  );
}
