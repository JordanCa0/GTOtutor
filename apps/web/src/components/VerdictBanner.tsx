import { bestOption, chosenOption, type ActionType, type DecisionFeedback } from '@gtotutor/shared-types';
import { optionColor } from './actionColors';
import { ApproxIcon, CheckIcon, XIcon } from './icons';
import { StarButton, StarNote } from './StarControl';

const pct = (f: number) => `${Math.round(f * 100)}%`;

const VERB: Record<ActionType, string> = { fold: 'fold', check: 'check', call: 'call', bet: 'bet', raise: 'raise', allin: 'shove' };
const AGGRESSION: Record<ActionType, number> = { fold: 0, check: 1, call: 1, bet: 2, raise: 2, allin: 2 };

/** The verdict in a player's words: "Good fold.", "Too loose.", "Fine. The chart mixes here." */
export function verdictTitle(feedback: Pick<DecisionFeedback, 'grade' | 'chosenAction' | 'bestAction' | 'sizeOnly'>): string {
  if (feedback.grade === 'best') return `Good ${VERB[feedback.chosenAction]}.`;
  if (feedback.sizeOnly) return 'Right idea, different size.';
  if (feedback.grade === 'mixed') return 'Fine. The chart mixes here.';
  const chosen = AGGRESSION[feedback.chosenAction];
  const best = AGGRESSION[feedback.bestAction];
  if (chosen < best) return chosen === 0 ? 'Too tight.' : 'Too passive.';
  if (chosen > best) return best === 0 ? 'Too loose.' : 'Too aggressive.';
  return 'Wrong size.';
}

const ICONS = { best: CheckIcon, mixed: ApproxIcon, mistake: XIcon } as const;

/** With `handId`, the decision can be starred (and given a note) from the banner. */
export function VerdictBanner({ feedback, handId }: { feedback: DecisionFeedback; handId?: string }) {
  const chosen = chosenOption(feedback);
  const best = bestOption(feedback);
  const chosenIdx = feedback.options.indexOf(chosen);
  const kind = feedback.options.filter((o) => o.actionId === chosen.actionId);
  const kindBest = kind.reduce((a, b) => (b.frequency > a.frequency ? b : a));
  const Icon = ICONS[feedback.grade];
  const source = feedback.street === 'preflop' ? 'The chart' : 'The solver';
  // For the main play the pills already say it all.
  const detail =
    feedback.grade === 'best'
      ? null
      : feedback.sizeOnly
        ? `${source} ${VERB[chosen.actionId]}s here ${pct(kind.reduce((s, o) => s + o.frequency, 0))} of the time, mostly ${kindBest.label} (${pct(kindBest.frequency)}). ${chosen.label} costs little EV.`
        : feedback.grade === 'mixed'
        ? `${source} prefers ${best.label} (${pct(best.frequency)}) but plays ${chosen.label} ${pct(chosen.frequency)} of the time.`
        : `${source} plays ${best.label} ${pct(best.frequency)} of the time, ${chosen.label} only ${pct(chosen.frequency)}.`;
  const hasEv = feedback.options.some((o) => o.evBb !== null);

  return (
    <div className={`verdict verdict-${feedback.grade}`} key={feedback.id}>
      <span className="verdict-icon">
        <Icon size={18} />
      </span>
      <div className="verdict-body">
        <div className="verdict-title">
          <h2>{verdictTitle(feedback)}</h2>
          <span className="muted small">
            {feedback.handClass}, {feedback.nodeLabel}
            {feedback.hintUsed && <span className="badge">Hint used</span>}
          </span>
          {handId && <StarButton handId={handId} decisionId={feedback.id} />}
        </div>
        <div className="pills">
          {feedback.options.map((o, i) => (
            <span key={i} className={`pill ${i === chosenIdx ? 'chosen' : ''}`} style={{ ['--c' as string]: optionColor(feedback.options.map((x) => ({ id: x.actionId, toBb: x.toBb })), i) }}>
              {i === chosenIdx && <em>You</em>}
              {o.label} <b>{pct(o.frequency)}</b>
              {hasEv && o.evBb !== null && <span className="muted">, EV {o.evBb}bb</span>}
            </span>
          ))}
        </div>
        {detail && <p className="verdict-detail">{detail}</p>}
        {handId && <StarNote handId={handId} decisionId={feedback.id} />}
        {feedback.board.length > 0 && (
          <p className="muted small">
            Board {feedback.board.join(' ')}
            {feedback.approxFlop && `. This exact flop isn't solved yet, so these numbers come from the similar flop ${feedback.approxFlop}.`}
          </p>
        )}
      </div>
    </div>
  );
}
