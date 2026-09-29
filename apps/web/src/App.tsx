import type { ActionType, ChatMessage, HandView, StartHandRequest } from '@gtotutor/shared-types';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { api } from './api/client';
import { ActionLog } from './components/ActionLog';
import { DecisionPanel } from './components/DecisionPanel';
import { SessionReview } from './components/SessionReview';
import { SettingsMenu } from './components/SettingsMenu';
import { SetupScreen } from './components/SetupScreen';
import { Table } from './components/Table';
import { TitleScreen } from './components/TitleScreen';
import { actingAt } from './playback';
import { getSessionId, newSessionId } from './session';
import { useSettings } from './settings';
import { playSound } from './sound/soundEngine';
import { useTableSounds } from './sound/useTableSounds';
import { usePlayback } from './usePlayback';

/** Buttons always sit in the same place with the same colour; all-in takes the raise slot. */
const ACTION_SLOTS: { key: 'fold' | 'call' | 'raise'; ids: ActionType[]; placeholder: string }[] = [
  { key: 'fold', ids: ['fold'], placeholder: 'Fold' },
  { key: 'call', ids: ['call', 'check'], placeholder: 'Call' },
  { key: 'raise', ids: ['raise', 'allin'], placeholder: 'Raise' },
];

export function App() {
  const [settings, setSettings] = useState<StartHandRequest | null>(null);
  const [hand, setHand] = useState<HandView | null>(null);
  const [sessionId, setSessionId] = useState(getSessionId);
  const [decisionsPlayed, setDecisionsPlayed] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  const [showTitle, setShowTitle] = useState(true);
  const [configOpen, setConfigOpen] = useState(false);
  const { animations } = useSettings();

  const start = useMutation({
    mutationFn: (req: StartHandRequest) => api.startHand({ ...req, sessionId }),
    onSuccess: (h) => {
      setHand(h);
      setConfigOpen(false);
    },
  });

  const deal = (req: StartHandRequest) => {
    setSettings(req);
    start.mutate(req);
  };

  const closeReview = useCallback(() => setReviewOpen(false), []);

  if (!hand && showTitle) return <TitleScreen onStart={() => setShowTitle(false)} />;

  if (!hand) {
    return <SetupScreen initial={settings} starting={start.isPending} error={start.error?.message ?? null} onStart={deal} />;
  }

  return (
    <div className={`app ${animations ? '' : 'no-anim'}`}>
      <header>
        <strong className="brand">
          GTO<span>tutor</span>
        </strong>
        <span className="muted">
          6-max cash · {hand.config.stackDepthBb}bb · you are <b>{hand.heroPosition}</b>
        </span>
        <span className="spacer" />
        <SettingsMenu />
        <button className="ghost" onClick={() => setReviewOpen(true)}>
          Session review
        </button>
        <button className="ghost configure-btn" onClick={() => setConfigOpen(true)}>
          <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden>
            <path d="M3 5h8M15 5h2M3 10h2M9 10h8M3 15h10M17 15h0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            <circle cx="13" cy="5" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="7" cy="10" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="15" cy="15" r="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          Configure game
        </button>
      </header>

      {hand.dataSource.kind === 'fixture' && <div className="banner">Chart numbers come from placeholder ranges, not a solver yet. EVs arrive with the solver.</div>}

      <PlayArea
        key={hand.id}
        hand={hand}
        dealing={start.isPending}
        error={start.error?.message ?? null}
        onHand={setHand}
        onDecided={() => setDecisionsPlayed((n) => n + 1)}
        onNext={() => settings && start.mutate(settings)}
        chats={chats}
        onChat={(id, messages) => setChats((c) => ({ ...c, [id]: messages }))}
        animate={animations}
      />

      {configOpen && (
        <SetupScreen initial={settings} starting={start.isPending} error={start.error?.message ?? null} onStart={deal} onClose={() => setConfigOpen(false)} />
      )}

      {reviewOpen && (
        <SessionReview
          sessionId={sessionId}
          decisionsPlayed={decisionsPlayed}
          onClose={closeReview}
          onNewSession={() => {
            setSessionId(newSessionId());
            setDecisionsPlayed(0);
            setReviewOpen(false);
          }}
        />
      )}
    </div>
  );
}

interface PlayAreaProps {
  hand: HandView;
  dealing: boolean;
  error: string | null;
  onHand: (h: HandView) => void;
  onDecided: () => void;
  onNext: () => void;
  chats: Record<string, ChatMessage[]>;
  onChat: (decisionId: string, messages: ChatMessage[]) => void;
  animate: boolean;
}

function PlayArea({ hand, dealing, error, onHand, onDecided, onNext, chats, onChat, animate }: PlayAreaProps) {
  const { playback, done, skip } = usePlayback(hand, animate);
  useTableSounds(hand, playback, animate);
  const decide = useMutation({
    mutationFn: (action: ActionType) => api.decide(hand.id, action),
    onSuccess: ({ hand: h, feedback }) => {
      playSound(feedback.grade === 'best' ? 'good' : feedback.grade === 'mixed' ? 'mixed' : 'bad');
      onHand(h);
      onDecided();
    },
  });

  const acting = actingAt(hand, playback);
  const result = hand.result;
  const complete = hand.status === 'complete';

  return (
    <main>
      <section className="left">
        <div className="table-area">
          <Table hand={hand} playback={playback} onSkip={skip} />
        </div>

        <div className="controls">
          {!done ? (
            <div className="waiting">
              <span className="muted pulse">{acting && acting !== hand.heroPosition ? `${acting} is acting…` : complete ? 'Running it out…' : 'Dealing…'}</span>
              <button className="link" onClick={skip}>
                Skip animation
              </button>
            </div>
          ) : !complete ? (
            <div className="actions">
              {ACTION_SLOTS.map((slot) => {
                const action = hand.legalActions.find((a) => slot.ids.includes(a.id));
                return action ? (
                  <button key={slot.key} className={`act act-${slot.key}`} disabled={decide.isPending} onClick={() => decide.mutate(action.id)}>
                    {action.label}
                  </button>
                ) : (
                  <button key={slot.key} className={`act act-${slot.key} unavailable`} disabled title="Not an option in this spot">
                    {slot.placeholder}
                  </button>
                );
              })}
            </div>
          ) : (
            result && (
              <div className="result-strip">
                <span className="muted small">
                  Result <b className={result.heroNetBb > 0 ? 'up' : result.heroNetBb < 0 ? 'down' : ''}>{result.heroNetBb > 0 ? '+' : ''}{result.heroNetBb}bb</b> · {result.summary}
                </span>
                <button className="primary" onClick={onNext} disabled={dealing} autoFocus>
                  {dealing ? 'Dealing…' : 'Deal next hand'}
                </button>
              </div>
            )
          )}
          {(decide.error || error) && <p className="error small">{decide.error?.message ?? error}</p>}
        </div>

        <ActionLog entries={hand.actionLog.slice(0, playback.steps)} />
      </section>

      <aside className="right">
        <DecisionPanel hand={hand} playbackDone={done} chats={chats} onChat={onChat} />
      </aside>
    </main>
  );
}
