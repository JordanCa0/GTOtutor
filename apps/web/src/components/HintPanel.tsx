import type { HandView } from '@gtotutor/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api/client';
import { CoachLoader } from './CoachLoader';
import { PlayingCard } from './PlayingCard';

export function HintPanel({ hand }: { hand: HandView }) {
  const spot = hand.pendingSpot!;
  const [asked, setAsked] = useState(false);
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ['hint', hand.id, spot.nodeKey],
    queryFn: () => api.hint(hand.id),
    enabled: asked,
  });

  return (
    <div className="spot-card">
      <p className="eyebrow">Your decision</p>
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
      <p className="muted small">
        Pick an action under the table. You'll see the {spot.street === 'preflop' ? "chart's" : "solver's"} answer and the full range right after, and can ask the coach to analyze it.
      </p>

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
    </div>
  );
}
