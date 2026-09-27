import type { HandView } from '@gtotutor/shared-types';
import { useState } from 'react';
import { FeedbackPanel } from './FeedbackPanel';
import { PlayingCard } from './PlayingCard';

export function HandSummary({ hand, onNext }: { hand: HandView; onNext: () => void }) {
  const [open, setOpen] = useState<string | null>(hand.decisions.at(-1)?.id ?? null);
  const r = hand.result!;
  const net = r.heroNetBb;

  return (
    <div className="summary">
      <div className="result-line">
        <span className={`net ${net > 0 ? 'up' : net < 0 ? 'down' : ''}`}>
          {net > 0 ? '+' : ''}
          {net}bb
        </span>
        <span>{r.summary}</span>
        <button className="primary" onClick={onNext} autoFocus>
          Deal next hand
        </button>
      </div>

      {r.showdown && (
        <div className="showdown">
          {r.showdown.map((s) => (
            <div key={s.position} className={s.isWinner ? 'winner' : ''}>
              <strong>{hand.heroPosition === s.position ? `You (${s.position})` : s.position}</strong>
              {s.cards.map((c) => (
                <PlayingCard key={c} card={c} size="sm" />
              ))}
              <span>{s.handName}</span>
            </div>
          ))}
        </div>
      )}

      <h3>Your decisions this hand</h3>
      <ul className="review">
        {hand.decisions.map((d) => (
          <li key={d.id}>
            <button className={`review-row grade-${d.grade}`} onClick={() => setOpen(open === d.id ? null : d.id)}>
              <span className="dot" />
              <span>{d.nodeLabel}</span>
              <span className="muted">
                {d.handClass} · {d.options.find((o) => o.actionId === d.chosenAction)!.label}
              </span>
              <span className="chev">{open === d.id ? '−' : '+'}</span>
            </button>
            {open === d.id && <FeedbackPanel handId={hand.id} feedback={d} />}
          </li>
        ))}
      </ul>
    </div>
  );
}
