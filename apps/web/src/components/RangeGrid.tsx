import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { ACTION_COLORS, STRIPE_ORDER } from './actionColors';

const DESC = 'AKQJT98765432';
const GRID: string[][] = [...DESC].map((r1, row) =>
  [...DESC].map((r2, col) => (row === col ? r1 + r2 : col > row ? r1 + r2 + 's' : r2 + r1 + 'o')),
);
const combos = (hc: string) => (hc.length === 2 ? 6 : hc[2] === 's' ? 4 : 12);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export function RangeGrid({ nodeKey, highlight }: { nodeKey: string; highlight: string }) {
  const { data, isPending, error } = useQuery({ queryKey: ['chart', nodeKey], queryFn: () => api.chart(nodeKey) });
  if (isPending) return <div className="range placeholder" />;
  if (error) return <p className="error small">{error.message}</p>;

  const background = (hc: string) => {
    const freqs = data.strategy[hc];
    // Postflop, classes that never reach this spot have no strategy.
    if (!freqs) return 'transparent';
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
  for (const hc of GRID.flat()) {
    if (!data.strategy[hc]) continue;
    all += combos(hc);
    data.strategy[hc].forEach((f, i) => (totals[i] += f * combos(hc)));
  }

  return (
    <section className="range">
      <div className="range-grid" role="grid" aria-label={`Range chart: ${data.label}`}>
        {GRID.flat().map((hc) => (
          <div
            key={hc}
            className={`cell ${hc === highlight ? 'me' : ''}`}
            style={{ background: background(hc) }}
            title={data.strategy[hc] ? `${hc}: ${data.actions.map((a, i) => `${a.label} ${pct(data.strategy[hc][i])}`).join(', ')}` : `${hc}: not in the range here`}
          >
            {hc}
          </div>
        ))}
      </div>
      <aside className="range-side">
        <p className="eyebrow">{data.dataSource.kind === 'solver' ? 'Flop strategy' : 'Range chart'}</p>
        <p className="range-title">{data.label}</p>
        <p className="label">Whole range</p>
        {data.actions.map((a, i) => (
          <div key={a.id} className="range-row">
            <i style={{ background: ACTION_COLORS[a.id] }} />
            <span>{a.label}</span>
            <b>{pct(totals[i] / (all || 1))}</b>
          </div>
        ))}
        {data.strategy[highlight] && (
          <>
            <p className="label">{data.dataSource.kind === 'solver' ? `${highlight} on average` : `Your hand · ${highlight}`}</p>
            <div className="mini-bar">
              {data.actions.map((a, i) => (
                <span key={a.id} style={{ flex: data.strategy[highlight][i], background: ACTION_COLORS[a.id] }} />
              ))}
            </div>
          </>
        )}
      </aside>
    </section>
  );
}
