import type { DecisionFeedback } from '@gtotutor/shared-types';
import { ACTION_COLORS } from './actionColors';

const pct = (f: number) => `${Math.round(f * 100)}%`;

const TITLES = {
  best: { title: 'Good decision', icon: '✓' },
  mixed: { title: 'Acceptable — mixed spot', icon: '≈' },
  mistake: { title: 'Mistake', icon: '✕' },
} as const;

export function VerdictBanner({ feedback }: { feedback: DecisionFeedback }) {
  const chosen = feedback.options.find((o) => o.actionId === feedback.chosenAction)!;
  const best = feedback.options.find((o) => o.actionId === feedback.bestAction)!;
  const { title, icon } = TITLES[feedback.grade];
  const source = feedback.street === 'preflop' ? 'The chart' : 'The solver';
  // For the main play the pills already say it all.
  const detail =
    feedback.grade === 'best'
      ? null
      : feedback.grade === 'mixed'
        ? `${source} prefers ${best.label} (${pct(best.frequency)}) but plays ${chosen.label} ${pct(chosen.frequency)} of the time.`
        : `${source} plays ${best.label} ${pct(best.frequency)} of the time, ${chosen.label} only ${pct(chosen.frequency)}.`;
  const hasEv = feedback.options.some((o) => o.evBb !== null);

  return (
    <div className={`verdict verdict-${feedback.grade}`} key={feedback.id}>
      <span className="verdict-icon" aria-hidden>
        {icon}
      </span>
      <div className="verdict-body">
        <div className="verdict-title">
          <h2>{title}</h2>
          <span className="muted small">
            {feedback.handClass} · {feedback.nodeLabel}
            {feedback.hintUsed && <span className="badge">hint used</span>}
          </span>
        </div>
        <div className="pills">
          {feedback.options.map((o) => (
            <span key={o.actionId} className={`pill ${o.actionId === feedback.chosenAction ? 'chosen' : ''}`} style={{ ['--c' as string]: ACTION_COLORS[o.actionId] }}>
              {o.actionId === feedback.chosenAction && <em>You</em>}
              {o.label} <b>{pct(o.frequency)}</b>
              {hasEv && o.evBb !== null && <span className="muted"> · EV {o.evBb}bb</span>}
            </span>
          ))}
        </div>
        {detail && <p className="verdict-detail">{detail}</p>}
        {feedback.board.length > 0 && (
          <p className="muted small">
            Board {feedback.board.join(' ')}
            {feedback.approxFlop && ` · this exact flop isn't solved yet, so these numbers come from the similar flop ${feedback.approxFlop}`}
          </p>
        )}
      </div>
    </div>
  );
}
