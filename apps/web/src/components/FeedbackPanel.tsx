import type { DecisionFeedback } from '@gtotutor/shared-types';
import { useState } from 'react';
import { ACTION_COLORS } from './actionColors';
import { ExplanationPanel } from './ExplanationPanel';
import { PlayingCard } from './PlayingCard';
import { RangeGrid } from './RangeGrid';

const GRADE_TEXT = {
  best: { title: 'Matches the chart', cls: 'good' },
  mixed: { title: 'Acceptable — part of a mixed strategy', cls: 'ok' },
  mistake: { title: 'Mistake — the chart rarely or never does this', cls: 'bad' },
} as const;

export function FeedbackPanel({ handId, feedback }: { handId: string; feedback: DecisionFeedback }) {
  const [showRange, setShowRange] = useState(false);
  const grade = GRADE_TEXT[feedback.grade];
  const chosen = feedback.options.find((o) => o.actionId === feedback.chosenAction)!;
  const hasEv = feedback.options.some((o) => o.evBb !== null);

  return (
    <div className="feedback">
      <div className={`grade ${grade.cls}`}>
        <strong>{grade.title}</strong>
        <span>
          You chose <b>{chosen.label}</b> with{' '}
          <span className="inline-cards">
            {feedback.heroCards.map((c) => (
              <PlayingCard key={c} card={c} size="sm" />
            ))}
          </span>{' '}
          ({feedback.handClass}) · {feedback.nodeLabel}
        </span>
      </div>

      <div className="freqs">
        {feedback.options.map((o) => (
          <div key={o.actionId} className={`freq-row ${o.actionId === feedback.chosenAction ? 'chosen' : ''}`}>
            <span className="freq-label">{o.label}</span>
            <span className="freq-bar">
              <span style={{ width: `${o.frequency * 100}%`, background: ACTION_COLORS[o.actionId] }} />
            </span>
            <span className="freq-pct">{Math.round(o.frequency * 100)}%</span>
            {hasEv && <span className="freq-ev">{o.evBb === null ? '—' : `${o.evBb > 0 ? '+' : ''}${o.evBb}bb`}</span>}
          </div>
        ))}
        {!hasEv && <p className="muted small">EV per action appears once the solver replaces the placeholder charts.</p>}
      </div>

      <button className="link" onClick={() => setShowRange((s) => !s)}>
        {showRange ? 'Hide' : 'Show'} full range chart for this spot
      </button>
      {showRange && <RangeGrid nodeKey={feedback.nodeKey} highlight={feedback.handClass} />}

      <ExplanationPanel handId={handId} decisionId={feedback.id} />
    </div>
  );
}
