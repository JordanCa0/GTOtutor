import type { ChatMessage, DecisionFeedback } from '@gtotutor/shared-types';
import { useEffect, useState } from 'react';
import { CoachThread } from './CoachThread';
import { PlayingCard } from './PlayingCard';
import { MaximizeIcon, SparklesIcon } from './icons';
import { Backdrop, Presence } from './Presence';
import { verdictTitle } from './VerdictBanner';

interface Props {
  handId: string;
  decision: DecisionFeedback;
  messages: ChatMessage[];
  onMessages: (messages: ChatMessage[]) => void;
}

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
        <span className="coach-avatar">
          <SparklesIcon size={15} />
        </span>
        <div>
          <strong>Coach</strong>
          <span className="muted small">Ask why, or ask anything about this hand.</span>
        </div>
        <button className="icon-btn" onClick={() => setReading(true)} aria-label="Open coach in reading view" title="Open in reading view">
          <MaximizeIcon />
        </button>
      </header>
      {thread('panel')}

      <Presence show={reading}>
        <Backdrop onClose={() => setReading(false)}>
          <div className="reader" role="dialog" aria-modal="true" aria-label="Coach reading view" onClick={(e) => e.stopPropagation()}>
            <div className="reader-head">
              <div>
                <p className="eyebrow">{verdictTitle(decision)}</p>
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
        </Backdrop>
      </Presence>
    </section>
  );
}
