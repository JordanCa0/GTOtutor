import type { ChatMessage, DecisionFeedback, HandView, StreakUpdate } from '@gtotutor/shared-types';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CoachCard } from './CoachCard';
import { HintPanel } from './HintPanel';
import { RangeGrid } from './RangeGrid';
import { RangeSkeleton, Skeleton, SkeletonGroup, useSkeleton } from './Skeleton';
import { StreakBadge } from './Streak';
import { VerdictBanner } from './VerdictBanner';
import { mixedPotDepth } from '../playback';

export type SheetTab = 'verdict' | 'chart' | 'coach' | 'hand';

/** In the phone sheet the panel shows one part at a time behind tabs; on desktop everything is stacked. */
interface SheetMode {
  tab: SheetTab;
  onTab: (tab: SheetTab) => void;
  /** The Hand tab: the action log and credits, which sit under the table on desktop. */
  handTab: ReactNode;
}

interface Props {
  hand: HandView;
  playbackDone: boolean;
  chats: Record<string, ChatMessage[]>;
  onChat: (decisionId: string, messages: ChatMessage[]) => void;
  streak?: StreakUpdate | null;
  sheet?: SheetMode;
}

export function DecisionPanel({ hand, playbackDone, chats, onChat, streak = null, sheet }: Props) {
  const showPending = hand.status === 'awaiting_hero' && playbackDone && hand.pendingSpot !== null;
  const itemCount = hand.decisions.length + (showPending ? 1 : 0);
  const [selected, setSelected] = useState(itemCount - 1);
  // A new decision normally takes over the panel, but not while hero is studying the enlarged chart:
  // then the "Now" tab (and a button in the chart) light up instead.
  const [chartOpen, setChartOpen] = useState(false);
  const shownHand = useRef(hand.id);
  useEffect(() => {
    const newHand = shownHand.current !== hand.id;
    shownHand.current = hand.id;
    if (newHand || !chartOpen) setSelected(itemCount - 1);
  }, [itemCount, hand.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const skeleton = useSkeleton(itemCount === 0);
  const complete = hand.status === 'complete' && playbackDone;
  const matched = hand.decisions.filter((d) => d.grade === 'best').length;
  const mistakes = hand.decisions.filter((d) => d.grade === 'mistake').length;

  if (itemCount === 0 && !sheet) {
    return (
      <SkeletonGroup visible={skeleton.visible} label="Dealing" className="skeleton-stack">
        <Skeleton kind="block" height="4.5rem" />
        <RangeSkeleton />
        <Skeleton kind="block" height="3rem" />
      </SkeletonGroup>
    );
  }

  const decision: DecisionFeedback | undefined = hand.decisions[selected];
  const isPending = showPending && selected === hand.decisions.length;
  const nextWaiting = showPending && !isPending;
  // Sheet tabs: a graded decision has all four; the spot you're deciding on (or none yet) has its own and the hand.
  const tabs: { id: SheetTab; label: string }[] = decision && !isPending
    ? [
        { id: 'verdict', label: 'Verdict' },
        { id: 'chart', label: 'Chart' },
        { id: 'coach', label: 'Coach' },
        { id: 'hand', label: 'Hand' },
      ]
    : [
        { id: 'verdict', label: 'Spot' },
        { id: 'hand', label: 'Hand' },
      ];
  const tab = sheet && tabs.some((t) => t.id === sheet.tab) ? sheet.tab : 'verdict';
  const hide = (part: SheetTab) => (sheet ? tab !== part : false);

  return (
    <div className="decision-panel">
      {sheet && (
        <div className="sheet-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'on' : ''} onClick={() => sheet.onTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      {sheet && (
        <div className="panel-part" hidden={hide('hand')}>
          {sheet.handTab}
        </div>
      )}
      <div className="panel-part" hidden={tab === 'hand' && !!sheet}>
      {complete && hand.decisions.length > 1 && (
        <div className={`hand-verdict ${mistakes ? 'bad' : matched === hand.decisions.length ? 'good' : 'ok'}`}>
          {matched} of {hand.decisions.length} decision{hand.decisions.length > 1 ? 's' : ''} matched the chart
          {mistakes > 0 && `, ${mistakes} mistake${mistakes > 1 ? 's' : ''}`}
        </div>
      )}
      {itemCount > 1 && (
        <div className="stepper" role="tablist">
          {hand.decisions.map((d, i) => (
            <button key={d.id} role="tab" aria-selected={selected === i} className={`step grade-${d.grade} ${selected === i ? 'on' : ''}`} onClick={() => setSelected(i)}>
              <span className="dot" /> Decision {i + 1}
            </button>
          ))}
          {showPending && (
            <button role="tab" aria-selected={isPending} className={`step ${isPending ? 'on' : ''} ${nextWaiting ? 'ready' : ''}`} onClick={() => setSelected(hand.decisions.length)}>
              Now
            </button>
          )}
        </div>
      )}

      </div>

      {isPending ? (
        <div className="panel-part" hidden={hide('verdict')}>
          <HintPanel key={hand.pendingSpot!.nodeKey + hand.id} hand={hand} />
        </div>
      ) : decision ? (
        <>
          <div className="panel-part" hidden={hide('verdict')}>
            {selected === hand.decisions.length - 1 && <StreakBadge streak={streak} />}
            <VerdictBanner feedback={decision} handId={hand.id} approxStacksBb={decision.street === 'preflop' ? null : mixedPotDepth(hand)} />
          </div>
          <div className="panel-part" hidden={hide('chart')}>
            <RangeGrid
              key={decision.id}
              nodeKey={decision.nodeKey}
              highlight={decision.handClass}
              inline={!!sheet}
              onOpenChange={setChartOpen}
              onNext={nextWaiting ? () => setSelected(hand.decisions.length) : undefined}
            />
          </div>
          <div className="panel-part" hidden={hide('coach')}>
            <CoachCard key={`coach-${decision.id}`} handId={hand.id} decision={decision} messages={chats[decision.id] ?? []} onMessages={(m) => onChat(decision.id, m)} />
          </div>
        </>
      ) : sheet ? (
        <div className="panel-part muted small" hidden={hide('verdict')}>
          Dealing…
        </div>
      ) : null}
    </div>
  );
}
