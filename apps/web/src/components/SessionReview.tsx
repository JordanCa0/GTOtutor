import type { SessionReviewResponse } from '@gtotutor/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { api } from '../api/client';
import { PlayingCard } from './PlayingCard';

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');

interface Props {
  sessionId: string;
  decisionsPlayed: number;
  onClose: () => void;
  onNewSession: () => void;
}

export function SessionReview({ sessionId, decisionsPlayed, onClose, onNewSession }: Props) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['review', sessionId, decisionsPlayed],
    queryFn: () => api.review(sessionId),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Session review" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Session review</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        {isPending ? <p className="muted pulse">Crunching your session…</p> : error ? <p className="error">{error.message}</p> : <ReviewBody data={data} onRetry={() => refetch()} />}
        <div className="modal-foot">
          <button className="secondary" onClick={onNewSession}>
            Start a new session
          </button>
        </div>
      </div>
    </div>
  );
}

function ReviewBody({ data, onRetry }: { data: SessionReviewResponse; onRetry: () => void }) {
  const { stats, coach } = data;
  if (stats.decisions === 0) return <p className="muted">Play a few hands and your review will show up here.</p>;
  const g = stats.grades;
  return (
    <div className="review-grid">
      <section>
        <p className="big-stat">
          {pct(g.best, stats.decisions)} <span className="muted small">of {stats.decisions} decisions matched the chart</span>
        </p>
        <div className="grade-bar">
          <span className="good" style={{ flex: g.best }} />
          <span className="ok" style={{ flex: g.mixed }} />
          <span className="bad" style={{ flex: g.mistake }} />
        </div>
        <p className="muted small">
          {stats.hands} hands · {g.best} best · {g.mixed} mixed · {g.mistake} mistake{g.mistake === 1 ? '' : 's'} · {stats.hintsUsed} hint{stats.hintsUsed === 1 ? '' : 's'} used
          {stats.easyFoldsSkipped && ' · easy folds were mostly skipped, so this skews toward harder spots'}
        </p>

        <h3>By spot</h3>
        <table className="spot-table">
          <thead>
            <tr>
              <th>Spot</th>
              <th>Decisions</th>
              <th>Matched</th>
              <th>Mistakes</th>
            </tr>
          </thead>
          <tbody>
            {stats.bySpot.map((s) => (
              <tr key={s.spot}>
                <td>{s.label}</td>
                <td>{s.decisions}</td>
                <td>{pct(s.best, s.decisions)}</td>
                <td>{s.mistakes}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {stats.worstMistakes.length > 0 && (
          <>
            <h3>Biggest mistakes</h3>
            <ul className="mistakes">
              {stats.worstMistakes.map((m, i) => (
                <li key={i}>
                  <span className="mini-cards">
                    {m.heroCards.map((c) => (
                      <PlayingCard key={c} card={c} size="xs" />
                    ))}
                  </span>
                  <span>
                    {m.nodeLabel}: you chose <b>{m.chosenLabel}</b> ({Math.round(m.chosenFrequency * 100)}%), chart plays <b>{m.bestLabel}</b> ({Math.round(m.bestFrequency * 100)}%)
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="review-coach">
        <h3>Coach's take</h3>
        {stats.leaks.length > 0 && (
          <ul className="leak-list">
            {stats.leaks.map((l) => (
              <li key={l.type}>
                {l.label} <b>×{l.count}</b>
              </li>
            ))}
          </ul>
        )}
        {coach.status === 'not_enough_data' ? (
          <p className="muted small">Play {coach.needed} more decision{coach.needed > 1 ? 's' : ''} for the coach's written review.</p>
        ) : coach.status === 'unavailable' ? (
          <p className="muted small">
            Coach unavailable: {coach.reason}{' '}
            <button className="link" onClick={onRetry}>
              Retry
            </button>
          </p>
        ) : (
          <>
            <p>{coach.summary}</p>
            {coach.leaks.map((l) => (
              <div key={l.title} className="leak">
                <strong>{l.title}</strong>
                <p>{l.advice}</p>
              </div>
            ))}
            <div className="drill">
              <strong>Next session drill</strong>
              <p>{coach.drill}</p>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
