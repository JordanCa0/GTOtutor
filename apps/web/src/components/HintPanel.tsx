import type { HandView, VillainRange } from '@gtotutor/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { ACTION_COLORS } from './actionColors';
import { CoachLoader } from './CoachLoader';
import { PlayingCard } from './PlayingCard';
import { combos, GRID } from './RangeGrid';

const round = (n: number) => Math.round(n * 100) / 100;

export function HintPanel({ hand }: { hand: HandView }) {
  const spot = hand.pendingSpot!;
  const [asked, setAsked] = useState(false);
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['hint', hand.id, spot.nodeKey],
    queryFn: () => api.hint(hand.id),
    enabled: asked,
  });

  // Pot odds, preflop only: there every chip committed so far is in this street's betting.
  const hero = hand.seats.find((s) => s.isHero)!;
  const facing = Math.max(...hand.seats.map((s) => s.committedBb));
  const toCall = spot.street === 'preflop' ? round(Math.min(facing - hero.committedBb, hero.stackBb)) : 0;
  const needed = toCall > 0 ? toCall / (hand.potBb + toCall) : null;

  return (
    <div className="spot-card">
      <h2>{spot.nodeLabel}</h2>
      <div className="spot-hand">
        {hand.heroCards.map((c) => (
          <PlayingCard key={c} card={c} size="sm" />
        ))}
        <span className="muted">{spot.handClass}</span>
        {spot.street !== 'preflop' && (
          <>
            <span className="muted">on</span>
            {hand.board.map((c) => (
              <PlayingCard key={c} card={c} size="sm" />
            ))}
          </>
        )}
      </div>

      <dl className="spot-facts">
        <div>
          <dt>Pot</dt>
          <dd>{hand.potBb}bb</dd>
        </div>
        {toCall > 0 && (
          <div>
            <dt>To call</dt>
            <dd>{toCall}bb</dd>
          </div>
        )}
        {needed !== null && (
          <div>
            <dt>Equity to call</dt>
            <dd>{Math.round(needed * 100)}%</dd>
          </div>
        )}
        <div>
          <dt>Behind</dt>
          <dd>{hero.stackBb}bb</dd>
        </div>
      </dl>

      {spot.villainRange && <VillainRangeView villain={spot.villainRange} highlight={spot.handClass} />}

      {!asked ? (
        <button className="secondary" onClick={() => setAsked(true)}>
          Ask the coach for a hint
        </button>
      ) : isFetching ? (
        <CoachLoader label="Finding a hint" />
      ) : error ? (
        <p className="error small">{error.message}</p>
      ) : data?.status === 'ok' ? (
        <div className="hint">
          <strong>Hint</strong>
          <p>{data.hint}</p>
        </div>
      ) : data ? (
        <p className="muted small">
          Hint unavailable: {data.reason}{' '}
          <button className="link" onClick={() => refetch()}>
            Retry
          </button>
        </p>
      ) : null}

      <p className="muted small">Pick an action under the table. The {spot.street === 'preflop' ? 'chart' : 'solver'}'s answer and the full range show up right after.</p>
    </div>
  );
}

/** The hands the last raiser takes their action with: their range, not your answer. */
function VillainRangeView({ villain, highlight }: { villain: VillainRange; highlight: string }) {
  const { data } = useQuery({ queryKey: ['chart', villain.nodeKey], queryFn: () => api.chart(villain.nodeKey) });
  if (!data) return <div className="villain-range placeholder" />;

  const idx = data.actions.findIndex((a) => a.id === villain.actionId);
  const freq = (hc: string) => (idx >= 0 ? (data.strategy[hc]?.[idx] ?? 0) : 0);
  const share = GRID.flat().reduce((s, hc) => s + freq(hc) * combos(hc), 0) / 1326;
  const color = ACTION_COLORS[villain.actionId];
  const verb = villain.actionId === 'allin' ? 'shoves' : 'raises';

  return (
    <section className="villain-range">
      <div className="range-grid" role="img" aria-label={`${villain.position}'s range: ${Math.round(share * 100)}% of hands`}>
        {GRID.flat().map((hc) => {
          const f = freq(hc);
          return (
            <div
              key={hc}
              className={`cell ${hc === highlight ? 'me' : ''}`}
              style={{ background: f > 0 ? `color-mix(in srgb, ${color} ${Math.round(25 + f * 75)}%, var(--cell-empty))` : 'var(--cell-empty)' }}
              title={`${hc}: ${Math.round(f * 100)}%`}
            />
          );
        })}
      </div>
      <div className="range-side">
        <p className="range-title">
          {villain.position} {verb} {Math.round(share * 100)}% of hands here
        </p>
        <p className="muted small">That's the range you're up against. Brighter means more often. Your hand is outlined.</p>
      </div>
    </section>
  );
}
