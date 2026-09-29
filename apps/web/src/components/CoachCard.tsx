import type { ChatMessage, DecisionFeedback } from '@gtotutor/shared-types';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CoachThread } from './CoachThread';
import { PlayingCard } from './PlayingCard';

interface Props {
  handId: string;
  decision: DecisionFeedback;
  messages: ChatMessage[];
  onMessages: (messages: ChatMessage[]) => void;
}

const GRADE_TITLE = { best: 'Good decision', mixed: 'Acceptable — mixed spot', mistake: 'Mistake' } as const;

export function CoachCard({ handId, decision, messages, onMessages }: Props) {
  const [reading, setReading] = useState(false);

  useEffect(() => {
    if (!reading) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setReading(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [reading]);

  const thread = (variant: 'panel' | 'reader') => (
    <CoachThread handId={handId} decisionId={decision.id} messages={messages} onMessages={onMessages} variant={variant} />
  );

  return (
    <section className="coach-card">
      <header>
        <span className="coach-avatar" aria-hidden>
          ♠
        </span>
        <div>
          <strong>Coach</strong>
          <span className="muted small">Explains the chart's play · ask anything about this spot</span>
        </div>
        <button className="icon-btn" onClick={() => setReading(true)} aria-label="Open coach in reading view" title="Open in reading view">
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
            <path d="M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      {thread('panel')}

      {/* Portal: the panel's backdrop-filter/transform would otherwise trap this fixed overlay inside it. */}
      {reading &&
        createPortal(
        <div className="modal-backdrop" onClick={() => setReading(false)}>
          <div className="reader" role="dialog" aria-modal="true" aria-label="Coach reading view" onClick={(e) => e.stopPropagation()}>
            <div className="reader-head">
              <div>
                <p className="eyebrow">{GRADE_TITLE[decision.grade]}</p>
                <h2>{decision.nodeLabel}</h2>
                <div className="spot-hand">
                  {decision.heroCards.map((c) => (
                    <PlayingCard key={c} card={c} size="sm" />
                  ))}
                  <span className="muted">{decision.handClass}</span>
                </div>
              </div>
              <button className="ghost" onClick={() => setReading(false)}>
                Close
              </button>
            </div>
            {thread('reader')}
          </div>
        </div>,
          document.body,
        )}
    </section>
  );
}
