import type { HandView, StreakUpdate } from '@gtotutor/shared-types';
import type { SheetTab } from './DecisionPanel';
import { ApproxIcon, CheckIcon, ChevronDownIcon, XIcon } from './icons';
import { verdictTitle } from './VerdictBanner';

const ICONS = { best: CheckIcon, mixed: ApproxIcon, mistake: XIcon } as const;

/**
 * Phone layout: one fixed-height line between the table and the action bar that says where you stand
 * (your turn, your last grade, the hand's result) and opens the sheet with the details. Its height never
 * changes, so the table doesn't either.
 */
export function FeedbackStrip({ hand, playbackDone, streak, onOpen }: { hand: HandView; playbackDone: boolean; streak: StreakUpdate | null; onOpen: (tab: SheetTab) => void }) {
  const pending = hand.status === 'awaiting_hero' && playbackDone && hand.pendingSpot !== null;
  const last = hand.decisions.at(-1);
  const complete = hand.status === 'complete' && playbackDone;
  const matched = hand.decisions.filter((d) => d.grade === 'best').length;

  let body;
  if (pending) {
    body = (
      <>
        <span className="strip-main">
          <strong>Your turn</strong>
          <span className="muted">{hand.pendingSpot!.nodeLabel}</span>
        </span>
        <span className="strip-cta">Spot and hint</span>
      </>
    );
  } else if (hand.multiway) {
    body = (
      <>
        <span className="strip-main">
          <strong>Not graded: multiway pot</strong>
          <span className="muted">{last ? `Before it: ${verdictTitle(last)}` : 'The charts only cover heads-up pots'}</span>
        </span>
        <span className="strip-cta">Why</span>
      </>
    );
  } else if (last) {
    const Icon = ICONS[last.grade];
    body = (
      <>
        <span className={`strip-icon grade-${last.grade}`} aria-hidden>
          <Icon size={14} />
        </span>
        <span className="strip-main">
          <strong>{verdictTitle(last)}</strong>
          <span className="muted">
            {complete && hand.decisions.length > 1 ? `${matched} of ${hand.decisions.length} matched the chart` : last.nodeLabel}
          </span>
        </span>
        {streak && streak.count >= 2 && !complete && (
          <span key={streak.count} className={`strip-streak ${streak.milestone ? 'milestone' : ''}`} aria-label={`${streak.count} in a row`}>
            ×{streak.count}
          </span>
        )}
        <span className="strip-cta">Chart and coach</span>
      </>
    );
  } else {
    body = <span className="strip-main muted">{complete ? 'No decisions for you this hand' : 'Waiting for your turn…'}</span>;
  }

  const enabled = pending || !!last || !!hand.multiway;
  return (
    <button className="feedback-strip" disabled={!enabled} onClick={() => onOpen('verdict')} aria-haspopup="dialog">
      <span key={pending ? 'pending' : hand.multiway ? 'multiway' : (last?.id ?? 'none')} className="strip-content">
        {body}
        {enabled && (
          <span className="strip-chevron" aria-hidden>
            <ChevronDownIcon size={16} />
          </span>
        )}
      </span>
    </button>
  );
}
