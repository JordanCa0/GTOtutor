import type { ChatMessage, DecisionFeedback, HandView } from '@gtotutor/shared-types';
import { useEffect, useState } from 'react';
import { CoachCard } from './CoachCard';
import { HintPanel } from './HintPanel';
import { RangeGrid } from './RangeGrid';
import { VerdictBanner } from './VerdictBanner';

interface Props {
  hand: HandView;
  playbackDone: boolean;
  chats: Record<string, ChatMessage[]>;
  onChat: (decisionId: string, messages: ChatMessage[]) => void;
}

export function DecisionPanel({ hand, playbackDone, chats, onChat }: Props) {
  const showPending = hand.status === 'awaiting_hero' && playbackDone && hand.pendingSpot !== null;
  const itemCount = hand.decisions.length + (showPending ? 1 : 0);
  const [selected, setSelected] = useState(itemCount - 1);
  useEffect(() => setSelected(itemCount - 1), [itemCount, hand.id]);

  const complete = hand.status === 'complete' && playbackDone;
  const matched = hand.decisions.filter((d) => d.grade === 'best').length;
  const mistakes = hand.decisions.filter((d) => d.grade === 'mistake').length;

  if (itemCount === 0) {
    return (
      <div className="panel-empty">
        <p className="muted pulse">Dealing…</p>
      </div>
    );
  }

  const decision: DecisionFeedback | undefined = hand.decisions[selected];
  const isPending = showPending && selected === hand.decisions.length;

  return (
    <div className="decision-panel">
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
            <button role="tab" aria-selected={isPending} className={`step ${isPending ? 'on' : ''}`} onClick={() => setSelected(hand.decisions.length)}>
              Now
            </button>
          )}
        </div>
      )}

      {isPending ? (
        <HintPanel key={hand.pendingSpot!.nodeKey + hand.id} hand={hand} />
      ) : decision ? (
        <>
          <VerdictBanner feedback={decision} />
          <RangeGrid key={decision.id} nodeKey={decision.nodeKey} highlight={decision.handClass} />
          <CoachCard key={`coach-${decision.id}`} handId={hand.id} decision={decision} messages={chats[decision.id] ?? []} onMessages={(m) => onChat(decision.id, m)} />
        </>
      ) : null}
    </div>
  );
}
