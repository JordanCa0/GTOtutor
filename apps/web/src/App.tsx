import type { ActionType, ChatMessage, HandView, LegalAction, StartHandRequest, StreakUpdate } from '@gtotutor/shared-types';
import { useMutation } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api/client';
import { ActionLog } from './components/ActionLog';
import { DecisionPanel } from './components/DecisionPanel';
import { SessionReview } from './components/SessionReview';
import { AccountDialogs, AccountMenu, openAccountDialog } from './components/AccountMenu';
import { optionColor } from './components/actionColors';
import { HeaderMenu } from './components/HeaderMenu';
import { ClipboardListIcon, HelpIcon, SlidersIcon, TrendingUpIcon } from './components/icons';
import { Presence } from './components/Presence';
import { ProfilePage } from './components/ProfilePage';
import { SettingsMenu } from './components/SettingsMenu';
import { dealRequest, SetupScreen, type DealSettings } from './components/SetupScreen';
import type { Celebration } from './components/Streak';
import { Table } from './components/Table';
import { TitleScreen } from './components/TitleScreen';
import { Tour, type TourStep } from './components/Tour';
import { useKaylie } from './components/Kaylie';
import { PLAY_STEPS, PLAY_STEPS_COMPACT, VERDICT_STEPS, VERDICT_STEPS_COMPACT } from './components/tourSteps';
import { BottomSheet } from './components/BottomSheet';
import { FeedbackStrip } from './components/FeedbackStrip';
import type { SheetTab } from './components/DecisionPanel';
import { useCompact } from './useMediaQuery';
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

/** "100bb", or with mixed stacks "100bb (BB 20bb)". */
function stacksText(hand: HandView): string {
  const odd = Object.entries(hand.config.stacks ?? {}).filter(([, s]) => s !== hand.config.stackDepthBb);
  return `${hand.config.stackDepthBb}bb${odd.length ? ` (${odd.map(([pos, s]) => `${pos} ${s}bb`).join(', ')})` : ''}`;
}

export function App() {
  const [settings, setSettings] = useState<DealSettings | null>(null);
  const [hand, setHand] = useState<HandView | null>(null);
  const [sessionId, setSessionId] = useState(getSessionId);
  const [decisionsPlayed, setDecisionsPlayed] = useState(0);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [chats, setChats] = useState<Record<string, ChatMessage[]>>({});
  const [showTitle, setShowTitle] = useState(() => !hasSeenTitle());
  const [configOpen, setConfigOpen] = useState(false);
  const [helpRequest, setHelpRequest] = useState(0);
  // The session's run of good decisions, and the latest milestone to celebrate. A new session starts over.
  const [streak, setStreak] = useState<StreakUpdate | null>(null);
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  useEffect(() => {
    setStreak(null);
    setCelebration(null);
  }, [sessionId]);
  // The profile opens over the table, so a hand in progress waits underneath.
  const [profileOpen, setProfileOpen] = useState(false);
  const openProfile = useCallback(() => setProfileOpen(true), []);
  const profile = (
    <Presence show={profileOpen}>
      <ProfilePage onClose={() => setProfileOpen(false)} />
    </Presence>
  );
  const { animations } = useSettings();
  const { enabled: accountsOn, ready: authReady, session } = useAuth();
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

  const deal = (req: DealSettings) => {
    markTitleSeen();
    setSettings(req);
    start.mutate(dealRequest(req, null));
  };

  const closeReview = useCallback(() => setReviewOpen(false), []);

  // Before the first hand there's no header, so the account control sits in the corner.
  const corner = (
    <div className="corner-account">
      <AccountMenu onProfile={openProfile} />
    </div>
  );
  // Guests see My progress too, so they can find it; for them it explains signing in instead of opening an empty page.
  const progress = () => (session ? openProfile() : openAccountDialog('progress'));
  const help = () => setHelpRequest((n) => n + 1);
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
        <AccountDialogs />
        {corner}
        <SetupScreen initial={settings} starting={start.isPending} error={start.error?.message ?? null} onStart={deal} />
        {profile}
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
          {stacksText(hand)} 6-max cash, you're in the <b>{hand.heroPosition}</b>
        </span>
        <span className="spacer" />
        {/* The table on one side, you and your progress on the other. Phones get HeaderMenu instead. */}
        <div className="header-group">
          <button className="ghost with-icon" onClick={() => setConfigOpen(true)}>
            <SlidersIcon size={15} />
            Configure game
          </button>
          <button className="icon-btn" onClick={help} aria-label="How it works" title="How it works">
            <HelpIcon size={17} />
          </button>
          <SettingsMenu />
        </div>
        <div className="header-group">
          <button className="ghost with-icon review-btn" onClick={() => setReviewOpen(true)}>
            <ClipboardListIcon size={15} />
            Session review
          </button>
          {accountsOn && authReady && (
            <button className="ghost with-icon" onClick={progress}>
              <TrendingUpIcon size={15} />
              My progress
            </button>
          )}
          <AccountMenu onProfile={openProfile} />
        </div>
        <HeaderMenu onConfigure={() => setConfigOpen(true)} onReview={() => setReviewOpen(true)} onProgress={progress} onHelp={help} />
      </header>
      <AccountDialogs />

      {hand.dataSource.kind === 'fixture' && <div className="banner">Chart numbers come from placeholder ranges, not a solver yet. EVs arrive with the solver.</div>}

      <PlayArea
        key={hand.id}
        hand={hand}
        dealing={start.isPending}
        error={start.error?.message ?? null}
        onHand={setHand}
        onDecided={(s) => {
          setDecisionsPlayed((n) => n + 1);
          setStreak(s);
          if (s.milestone) setCelebration({ milestone: s.milestone, at: Date.now() });
        }}
        streak={streak}
        celebration={celebration}
        onNext={() => settings && start.mutate(dealRequest(settings, hand.heroPosition))}
        chats={chats}
        onChat={(id, messages) => setChats((c) => ({ ...c, [id]: messages }))}
        animate={animations}
        helpRequest={helpRequest}
      />

      <Presence show={configOpen}>
        <SetupScreen initial={settings} starting={start.isPending} error={start.error?.message ?? null} onStart={deal} onClose={() => setConfigOpen(false)} />
      </Presence>

      {profile}

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
  onDecided: (streak: StreakUpdate) => void;
  streak: StreakUpdate | null;
  celebration: Celebration | null;
  onNext: () => void;
  chats: Record<string, ChatMessage[]>;
  onChat: (decisionId: string, messages: ChatMessage[]) => void;
  animate: boolean;
  /** Bumped by the header's ? button to replay the tour. */
  helpRequest: number;
}

function PlayArea({ hand, dealing, error, onHand, onDecided, streak, celebration, onNext, chats, onChat, animate, helpRequest }: PlayAreaProps) {
  const { playback, done, skip } = usePlayback(hand, animate);
  const kaylie = useKaylie();
  useTableSounds(hand, playback, animate);
  const decide = useMutation({
    mutationFn: (action: LegalAction) => api.decide(hand.id, action.id, action.toBb),
    onSuccess: ({ hand: h, feedback, streak: s }) => {
      // Free play (a pot with no solver data): the action is played, not graded.
      if (!feedback || !s) {
        onHand(h);
        return;
      }
      if (feedback.grade === 'best') playSound('good', 0, { count: s.count, milestone: s.milestone !== null });
      else if (feedback.grade === 'mixed') playSound('mixed');
      else {
        // A long run ending gets a soft falling note first, never anything harsher.
        if ((s.ended ?? 0) >= 5) playSound('streakEnd');
        playSound('bad', (s.ended ?? 0) >= 5 ? 260 : 0);
      }
      onHand(h);
      onDecided(s);
    },
  });

  // Waiting for a live turn solve: ask again every second until the hand moves on (the server gives up after ~20s).
  useEffect(() => {
    if (!hand.solving) return;
    const t = setInterval(() => {
      api
        .hand(hand.id)
        .then((h) => !h.solving && onHand(h))
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(t);
  }, [hand.id, hand.solving, onHand]);

  const acting = actingAt(hand, playback);
  const result = hand.result;
  const complete = hand.status === 'complete';

  // Phone layout: the decision panel lives in a bottom sheet, opened from the strip under the table.
  const compact = useCompact();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetTab, setSheetTab] = useState<SheetTab>('verdict');
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  // A new grade or the next spot starts on its first tab.
  useEffect(() => setSheetTab('verdict'), [hand.decisions.length]);

  // One entry per slot, in display order. Several sizes of one type (flop bets of 33/66/100%) fill the raise
  // slot together as one segmented group, smallest first, with shortcuts 1, 2, 3 (R also takes the smallest),
  // so the bar stays one row whatever the spot. Any other extra option (all-in next to a raise) gets its own
  // button after the slots. With nothing to fold to, the empty Fold slot is left out to make room.
  const sizedType = (['bet', 'raise'] as const).find((id) => hand.legalActions.filter((a) => a.id === id).length > 1);
  const sizes = hand.legalActions.filter((a) => a.id === sizedType).sort((a, b) => (a.toBb ?? 0) - (b.toBb ?? 0));
  const canCheck = hand.legalActions.some((a) => a.id === 'check');
  const slotted = ACTION_SLOTS.map((slot) => ({
    slot,
    action: slot.key === 'raise' && sizes.length ? sizes[0] : hand.legalActions.find((a) => slot.ids.includes(a.id)),
  })).filter(({ slot, action }) => action || !(slot.key === 'fold' && canCheck));
  const extras = hand.legalActions.filter((a) => !sizes.includes(a) && slotted.every((s) => s.action !== a));
  const shortcuts = new Map<string, LegalAction>();
  for (const { slot, action } of slotted) if (action) shortcuts.set(slot.key[0], action);
  sizes.forEach((a, i) => shortcuts.set(String(i + 1), a));
  let digit = sizes.length ? sizes.length + 1 : 2;
  for (const a of extras) shortcuts.set(a.id === 'allin' && !shortcuts.has('a') ? 'a' : String(digit++), a);
  // The key shown on a button: a size shows its digit (R stays a hidden alias for the smallest).
  const keyFor = (action: LegalAction) => {
    const keys = [...shortcuts].filter(([, v]) => v === action).map(([k]) => k);
    return sizes.includes(action) ? keys.find((k) => /\d/.test(k)) : keys[0];
  };
  // A bet reads as a share of the pot ("Bet 33%", with the chips below); a raise keeps its "Raise to" label.
  const sizeText = (a: LegalAction) =>
    a.id === 'bet' && a.toBb !== null && hand.potBb > 0 ? { main: `Bet ${Math.round((a.toBb / hand.potBb) * 100)}%`, sub: `${a.toBb}bb` } : { main: a.label, sub: null };

  const handLog = hand.actionLog.slice(0, playback.steps);
  const canAct = done && !complete && !decide.isPending;
  const canDeal = done && complete && !dealing;
  useEffect(() => {
    if (!canAct && !canDeal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || t.closest('input, textarea, select')) return;
      if (document.querySelector('.modal-backdrop, .tour, .sheet[data-open="true"]')) return;
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
      setTour({ steps: compact ? PLAY_STEPS_COMPACT : PLAY_STEPS, part: 'play' });
      return;
    }
    if (graded && !hasSeenTour('verdict')) {
      // Let the verdict and chart finish animating in first. If the panel has already moved on to a
      // later decision, wait for the next grade instead.
      const t = setTimeout(
        () => document.querySelector('.verdict') && setTour({ steps: compact ? VERDICT_STEPS_COMPACT : VERDICT_STEPS, part: 'verdict' }),
        700,
      );
      return () => clearTimeout(t);
    }
  }, [canAct, graded, tour, compact]);
  // The ? button replays both parts (steps for things not on screen yet are skipped). PlayArea remounts
  // every hand, so only react to presses made while this hand is up.
  const helpSeen = useRef(helpRequest);
  useEffect(() => {
    if (helpRequest === helpSeen.current) return;
    helpSeen.current = helpRequest;
    setSheetOpen(false);
    setTour({ steps: compact ? [...PLAY_STEPS_COMPACT, ...VERDICT_STEPS_COMPACT] : [...PLAY_STEPS, ...VERDICT_STEPS], part: null });
  }, [helpRequest]); // eslint-disable-line react-hooks/exhaustive-deps
  // While the verdict tour is up or about to open, the panel and strip stay on the graded decision instead
  // of jumping to the next spot; they move on when the tour ends.
  const holdPanel = !!tour || (graded && !hasSeenTour('verdict'));
  const panelDone = done && !holdPanel;
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
          <Table hand={hand} playback={playback} onSkip={skip} celebration={celebration} kaylie={kaylie} />
        </div>

        {compact && (
          <FeedbackStrip
            hand={hand}
            playbackDone={panelDone}
            streak={streak}
            onOpen={(t) => {
              setSheetTab(t);
              setSheetOpen(true);
            }}
          />
        )}

        <div className="controls">
          {!done ? (
            <div className="waiting">
              <span className="muted pulse">{acting && acting !== hand.heroPosition ? `${acting} is acting…` : complete ? 'Running it out…' : 'Dealing…'}</span>
              <button className="link" onClick={skip}>
                Skip animation
              </button>
            </div>
          ) : !complete && hand.solving ? (
            // The buttons' shape while the live solve runs, with the wait explained in the middle slot.
            <div className="actions" role="status" aria-label={`Solving the ${hand.solving}`}>
              {ACTION_SLOTS.map((slot) => (
                <span key={slot.key} className="act act-skeleton" aria-hidden>
                  {slot.key === 'call' ? `Solving the ${hand.solving}…` : ''}
                </span>
              ))}
            </div>
          ) : !complete ? (
            <div className="actions">
              {slotted.map(({ slot, action }) =>
                slot.key === 'raise' && sizes.length ? (
                  <div key={slot.key} className="act-group" role="group" aria-label={sizedType === 'bet' ? 'Bet sizes' : 'Raise sizes'}>
                    {sizes.map((a) => {
                      const { main, sub } = sizeText(a);
                      return (
                        <button
                          key={a.toBb}
                          className="act act-size"
                          style={{ ['--c' as string]: optionColor(hand.legalActions, hand.legalActions.indexOf(a)) }}
                          disabled={decide.isPending}
                          onClick={() => decide.mutate(a)}
                        >
                          <span className="act-size-text">
                            {main}
                            {sub && <small>{sub}</small>}
                          </span>
                          <ShortcutKey k={keyFor(a)} />
                        </button>
                      );
                    })}
                  </div>
                ) : action ? (
                  <button key={slot.key} className={`act act-${slot.key}`} disabled={decide.isPending} onClick={() => decide.mutate(action)}>
                    {action.label}
                    <ShortcutKey k={keyFor(action)} />
                  </button>
                ) : slot.key === 'call' && hand.noCallReason ? (
                  // Why there's no call ("3-bet or fold"), on hover or tap: the wrapper takes focus, as a disabled button can't.
                  <span key={slot.key} className="act-tip pos-tip" tabIndex={0} aria-describedby="no-call-tip">
                    <button className={`act act-${slot.key} unavailable`} disabled>
                      {slot.placeholder}
                    </button>
                    <span role="tooltip" id="no-call-tip" className="tooltip tip-above tip-center">
                      <strong>{hand.noCallReason.title}</strong>
                      <span>{hand.noCallReason.text}</span>
                    </span>
                  </span>
                ) : (
                  <button key={slot.key} className={`act act-${slot.key} unavailable`} disabled title="Not an option in this spot">
                    {slot.placeholder}
                  </button>
                ),
              )}
              {extras.map((a) => (
                <button key={`${a.id}-${a.toBb}`} className="act act-raise" disabled={decide.isPending} onClick={() => decide.mutate(a)}>
                  {a.label}
                  <ShortcutKey k={keyFor(a)} />
                </button>
              ))}
            </div>
          ) : (
            result && (
              <div className="result-strip">
                <span className="muted small">
                  Result <b className={result.heroNetBb > 0 ? 'up' : result.heroNetBb < 0 ? 'down' : ''}>{result.heroNetBb > 0 ? '+' : ''}{result.heroNetBb}bb</b>
                  <span className="result-summary">
                    . {result.summary}
                    {hand.liveNote && <> {hand.liveNote}</>}
                  </span>
                </span>
                <button className="primary" onClick={onNext} disabled={dealing} autoFocus>
                  {dealing ? 'Dealing…' : 'Deal next hand'}
                  <ShortcutKey k="n" />
                </button>
              </div>
            )
          )}
          {hand.multiway && !complete && done ? (
            <p className="muted small free-play-note">Not graded: this pot went multiway, and the charts and solver only cover heads-up pots.</p>
          ) : hand.freePlay && !complete && done ? (
            <p className="muted small free-play-note">Not graded: there's no solver data for this pot, so JEV AI plays your opponent and the hand plays out.</p>
          ) : hand.multiwayCall && canAct ? (
            <p className="muted small free-play-note">The charts keep pots heads-up here. You can still call, but the pot goes multiway and the rest of the hand isn't graded.</p>
          ) : null}
          {(decide.error || error) && <p className="error small">{decide.error?.message ?? error}</p>}
          {hand.solverCommit && !compact && <SolverCredit commit={hand.solverCommit} />}
        </div>

        {!compact && <ActionLog entries={handLog} board={hand.board} />}
      </section>

      {compact ? (
        <BottomSheet open={sheetOpen} onClose={closeSheet} label="Decision details">
          <DecisionPanel
            hand={hand}
            playbackDone={panelDone}
            chats={chats}
            onChat={onChat}
            streak={streak}
            sheet={{
              tab: sheetTab,
              onTab: setSheetTab,
              handTab: (
                <div className="sheet-hand">
                  <p className="label">This hand so far</p>
                  <ActionLog entries={handLog} board={hand.board} />
                  {result && <p className="muted small">{result.summary}</p>}
                  {hand.solverCommit && <SolverCredit commit={hand.solverCommit} />}
                </div>
              ),
            }}
          />
        </BottomSheet>
      ) : (
        <aside className="right">
          <DecisionPanel hand={hand} playbackDone={panelDone} chats={chats} onChat={onChat} streak={streak} />
        </aside>
      )}
    </main>
  );
}

/**
 * Where the turn and river strategies come from: postflop-solver (AGPL-3.0), run as a separate
 * service whose source, at the deployed commit, is public (docs/postflop-plan.md, AGPL condition 3).
 */
function SolverCredit({ commit }: { commit: string }) {
  const ref = /^[0-9a-f]{7,40}$/.test(commit) ? commit : 'main';
  return (
    <p className="muted small solver-credit">
      Turn and river solved live with{' '}
      <a href="https://github.com/b-inary/postflop-solver" target="_blank" rel="noreferrer">
        postflop-solver
      </a>{' '}
      (AGPL-3.0).{' '}
      <a href={`https://github.com/JordanCa0/GTOtutor/tree/${ref}/solver`} target="_blank" rel="noreferrer">
        Solver source{ref === 'main' ? '' : ` (${ref.slice(0, 7)})`}
      </a>
    </p>
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
