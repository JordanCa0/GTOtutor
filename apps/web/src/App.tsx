import type { ActionType, ChatMessage, HandView, StartHandRequest } from '@gtotutor/shared-types';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import { ActionLog } from './components/ActionLog';
import { DecisionPanel } from './components/DecisionPanel';
import { SessionReview } from './components/SessionReview';
import { AccountMenu } from './components/AccountMenu';
import { HelpIcon, SlidersIcon } from './components/icons';
import { Presence } from './components/Presence';
import { SettingsMenu } from './components/SettingsMenu';
import { SetupScreen } from './components/SetupScreen';
import { Table } from './components/Table';
import { TitleScreen } from './components/TitleScreen';
import { Tour, type TourStep } from './components/Tour';
import { PLAY_STEPS, VERDICT_STEPS } from './components/tourSteps';
import { actingAt } from './playback';
import { useAuth } from './auth/auth';
import { hasSeenTitle, hasSeenTour, markTitleSeen, markTourSeen, type TourPart } from './onboarding';
import { getSessionId, newSessionId } from './session';
import { useSettings } from './settings';
import { playSound } from './sound/soundEngine';
import { useTableSounds } from './sound/useTableSounds';
import { usePlayback } from './usePlayback';

/** Buttons always sit in the same place with the same colour; a bet or all-in takes the raise slot. */
const ACTION_SLOTS: { key: 'fold' | 'call' | 'raise'; ids: ActionType[]; placeholder: string }[] = [
  { key: 'fold', ids: ['fold'], placeholder: 'Fold' },
  { key: 'call', ids: ['call', 'check'], placeholder: 'Call' },
  { key: 'raise', ids: ['raise', 'bet', 'allin'], placeholder: 'Raise' },
];

export function App() {
  const [settings, setSettings] = useState<StartHandRequest | null>(null);
  const [hand, setHand] = useState<HandView | null>(null);
  const [sessionId, setSessionId] = useState(getSessionId);
  const [decisionsPlayed, setDecisionsPlayed] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  const [showTitle, setShowTitle] = useState(() => !hasSeenTitle());
  const [configOpen, setConfigOpen] = useState(false);
  const [helpRequest, setHelpRequest] = useState(0);
  const { animations } = useSettings();
  const { ready: authReady, session } = useAuth();
  const userId = session?.user.id ?? null;
  const prevUser = useRef(userId);
  // On <html> rather than .app so portaled modals and the title page follow the setting too.
  useEffect(() => {
    document.documentElement.classList.toggle('no-anim', !animations);
  }, [animations]);
  // Signing out: the hand on screen belongs to the account, so start over as a fresh guest.
  useEffect(() => {
    if (prevUser.current && !userId) {
      setHand(null);
      setChats({});
      setDecisionsPlayed(0);
      setSessionId(newSessionId());
    }
    prevUser.current = userId;
  }, [userId]);

  const start = useMutation({
    mutationFn: (req: StartHandRequest) => api.startHand({ ...req, sessionId }),
    onSuccess: (h) => {
      setHand(h);
      setConfigOpen(false);
    },
  });

  const deal = (req: StartHandRequest) => {
    markTitleSeen();
    setSettings(req);
    start.mutate(req);
  };

  const closeReview = useCallback(() => setReviewOpen(false), []);

  // Before the first hand there's no header, so the account control sits in the corner.
  const corner = (
    <div className="corner-account">
      <AccountMenu />
    </div>
  );
  // First visit only, and never once signed in. Wait for the stored session so signed-in users don't see it flash.
  if (!hand && showTitle && !userId) {
    if (!authReady) return null;
    return (
      <TitleScreen
        onGuest={() => {
          markTitleSeen();
          setShowTitle(false);
        }}
      />
    );
  }

  if (!hand) {
    return (
      <>
        {corner}
        <SetupScreen initial={settings} starting={start.isPending} error={start.error?.message ?? null} onStart={deal} />
      </>
    );
  }

  return (
    <div className="app">
      <header>
        <strong className="brand">
          GTO<span>tutor</span>
        </strong>
        <span className="muted">
          {hand.config.stackDepthBb}bb 6-max cash, you're in the <b>{hand.heroPosition}</b>
        </span>
        <span className="spacer" />
        <button className="ghost configure-btn" onClick={() => setConfigOpen(true)}>
          <SlidersIcon size={15} />
          Configure game
        </button>
        <button className="ghost review-btn" onClick={() => setReviewOpen(true)}>
          Session review
        </button>
        <button className="icon-btn" onClick={() => setHelpRequest((n) => n + 1)} aria-label="How it works" title="How it works">
          <HelpIcon size={17} />
        </button>
        <SettingsMenu />
        <AccountMenu />
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
        helpRequest={helpRequest}
      />

      <Presence show={configOpen}>
        <SetupScreen initial={settings} starting={start.isPending} error={start.error?.message ?? null} onStart={deal} onClose={() => setConfigOpen(false)} />
      </Presence>

      <Presence show={reviewOpen}>
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
      </Presence>
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
  /** Bumped by the header's ? button to replay the tour. */
  helpRequest: number;
}

function PlayArea({ hand, dealing, error, onHand, onDecided, onNext, chats, onChat, animate, helpRequest }: PlayAreaProps) {
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

  // One entry per button, in display order. A spot can offer two aggressive options (e.g. raise and all-in):
  // the slot takes the first, and the other gets its own button after the three fixed ones.
  const slotted = ACTION_SLOTS.map((slot) => ({ slot, action: hand.legalActions.find((a) => slot.ids.includes(a.id)) }));
  const extras = hand.legalActions.filter((a) => slotted.every((s) => s.action !== a));
  const shortcuts = new Map<string, ActionType>();
  for (const { slot, action } of slotted) if (action) shortcuts.set(slot.key[0], action.id);
  for (const a of extras) if (a.id === 'allin' && !shortcuts.has('a')) shortcuts.set('a', a.id);
  const keyFor = (id: ActionType) => [...shortcuts].find(([, v]) => v === id)?.[0];

  const canAct = done && !complete && !decide.isPending;
  const canDeal = done && complete && !dealing;
  useEffect(() => {
    if (!canAct && !canDeal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || t.closest('input, textarea, select')) return;
      if (document.querySelector('.modal-backdrop, .tour')) return;
      const k = e.key.toLowerCase();
      if (canAct && shortcuts.has(k)) {
        e.preventDefault();
        decide.mutate(shortcuts.get(k)!);
      } else if (canDeal && k === 'n') {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // First-run tour: part one once the first hand waits on you, part two after your first grade.
  const [tour, setTour] = useState<{ steps: TourStep[]; part: TourPart | null } | null>(null);
  const graded = hand.decisions.length > 0;
  useEffect(() => {
    if (tour) return;
    if (canAct && !hasSeenTour('play')) {
      setTour({ steps: PLAY_STEPS, part: 'play' });
      return;
    }
    if (graded && !hasSeenTour('verdict')) {
      // Let the verdict and chart finish animating in first. If the panel has already moved on to a
      // later decision, wait for the next grade instead.
      const t = setTimeout(() => document.querySelector('.verdict') && setTour({ steps: VERDICT_STEPS, part: 'verdict' }), 700);
      return () => clearTimeout(t);
    }
  }, [canAct, graded, tour]);
  // The ? button replays both parts (steps for things not on screen yet are skipped). PlayArea remounts
  // every hand, so only react to presses made while this hand is up.
  const helpSeen = useRef(helpRequest);
  useEffect(() => {
    if (helpRequest === helpSeen.current) return;
    helpSeen.current = helpRequest;
    setTour({ steps: [...PLAY_STEPS, ...VERDICT_STEPS], part: null });
  }, [helpRequest]);
  const endTour = useCallback(() => {
    setTour((t) => {
      if (t?.part) markTourSeen(t.part);
      return null;
    });
  }, []);

  return (
    <main>
      {tour && <Tour key={tour.part ?? 'all'} steps={tour.steps} onDone={endTour} />}
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
              {slotted.map(({ slot, action }) =>
                action ? (
                  <button key={slot.key} className={`act act-${slot.key}`} disabled={decide.isPending} onClick={() => decide.mutate(action.id)}>
                    {action.label}
                    <ShortcutKey k={keyFor(action.id)} />
                  </button>
                ) : (
                  <button key={slot.key} className={`act act-${slot.key} unavailable`} disabled title="Not an option in this spot">
                    {slot.placeholder}
                  </button>
                ),
              )}
              {extras.map((a) => (
                <button key={a.id} className="act act-raise" disabled={decide.isPending} onClick={() => decide.mutate(a.id)}>
                  {a.label}
                  <ShortcutKey k={keyFor(a.id)} />
                </button>
              ))}
            </div>
          ) : (
            result && (
              <div className="result-strip">
                <span className="muted small">
                  Result <b className={result.heroNetBb > 0 ? 'up' : result.heroNetBb < 0 ? 'down' : ''}>{result.heroNetBb > 0 ? '+' : ''}{result.heroNetBb}bb</b>. {result.summary}
                </span>
                <button className="primary" onClick={onNext} disabled={dealing} autoFocus>
                  {dealing ? 'Dealing…' : 'Deal next hand'}
                  <ShortcutKey k="n" />
                </button>
              </div>
            )
          )}
          {(decide.error || error) && <p className="error small">{decide.error?.message ?? error}</p>}
        </div>

        <ActionLog entries={hand.actionLog.slice(0, playback.steps)} board={hand.board} />
      </section>

      <aside className="right">
        <DecisionPanel hand={hand} playbackDone={done} chats={chats} onChat={onChat} />
      </aside>
    </main>
  );
}

/** Keyboard hint on an action button; hidden on touch screens by CSS. */
function ShortcutKey({ k }: { k?: string }) {
  return k ? (
    <kbd className="key" aria-hidden>
      {k.toUpperCase()}
    </kbd>
  ) : null;
}
