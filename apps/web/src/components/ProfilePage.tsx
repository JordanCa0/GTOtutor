import type { ChatMessage, StarredDecision } from '@gtotutor/shared-types';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { displayName, useAuth } from '../auth/auth';
import { CoachCard } from './CoachCard';
import { CoachLoader } from './CoachLoader';
import { PlayingCard } from './PlayingCard';
import { Backdrop, Presence } from './Presence';
import { RangeGrid } from './RangeGrid';
import { CoachSection, StatsSection } from './SessionReview';
import { StyleCard } from './StyleChart';
import { VerdictBanner, verdictTitle } from './VerdictBanner';

const pct = (f: number) => `${Math.round(f * 100)}%`;
/** "−0.14bb", "0.00bb": EV given up shows as a negative number, with a real minus sign. */
const signedBb = (bb: number) => `${bb < -0.005 ? '−' : ''}${Math.abs(bb).toFixed(2)}bb`;

/** The signed-in player's page: all-time review, style chart, and starred decisions. */
export function ProfilePage({ onClose }: { onClose: () => void }) {
  const { session } = useAuth();
  const [open, setOpen] = useState<StarredDecision | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !open && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  return (
    <div className="profile-page" role="dialog" aria-modal="true" aria-label="Your profile">
      <div className="profile-inner">
        <header className="profile-head">
          <div className="profile-id">
            {session && (
              <span className="profile-avatar" aria-hidden>
                {displayName(session).slice(0, 1).toUpperCase()}
              </span>
            )}
            <div>
              <h1>{session ? displayName(session) : 'Your profile'}</h1>
              {session?.user.email && <p className="muted small">{session.user.email}</p>}
            </div>
          </div>
          <button className="ghost" onClick={onClose}>
            Back to the table
          </button>
        </header>
        {session ? (
          <ProfileBody onOpen={setOpen} />
        ) : (
          <p className="muted">Sign in to keep your hands between visits and see your profile: your all-time review, your playing style, and the decisions you starred.</p>
        )}
      </div>
      <Presence show={!!open}>{open && <StarredDetail item={open} onClose={() => setOpen(null)} />}</Presence>
    </div>
  );
}

function ProfileBody({ onOpen }: { onOpen: (item: StarredDecision) => void }) {
  const profile = useQuery({ queryKey: ['profile'], queryFn: api.profile });
  // The coach's write-up loads separately so the numbers show straight away.
  const review = useQuery({ queryKey: ['profile-review'], queryFn: api.profileReview });

  if (profile.isPending) return <CoachLoader label="Adding up your hands" />;
  if (profile.error) return <p className="error">{profile.error.message}</p>;
  const { stats, style, gto, starredCount } = profile.data;
  if (stats.decisions === 0) return <p className="muted">Play some hands while signed in and your profile fills in here.</p>;

  const g = stats.grades;

  return (
    <>
      <section className="profile-stats" aria-label="Summary">
        <div className="profile-stat">
          <p className="profile-stat-label">Accuracy</p>
          <p className="profile-stat-value">{pct(gto.accuracy)}</p>
          <div className="grade-bar" aria-hidden>
            <span className="good" style={{ flex: g.best }} />
            <span className="ok" style={{ flex: g.mixed }} />
            <span className="bad" style={{ flex: g.mistake }} />
          </div>
          <p className="muted small">
            Best or mixed play in {stats.decisions} decisions. {g.mistake} mistake{g.mistake === 1 ? '' : 's'}.
          </p>
        </div>
        <div className="profile-stat">
          <p className="profile-stat-label">EV per decision</p>
          <p className={`profile-stat-value ${gto.evLossBb ? 'down' : ''}`}>{gto.evLossBb === null ? '–' : signedBb(-gto.evLossBb)}</p>
          <p className="muted small">
            {gto.evLossBb === null
              ? 'Shows up once you play flop spots or solved charts: the placeholder preflop charts have no EVs.'
              : `Against the best play in each spot, so 0 is perfect. Over ${gto.evDecisions} decisions with EVs.`}
          </p>
        </div>
        <div className="profile-stat">
          <p className="profile-stat-label">Hands</p>
          <p className="profile-stat-value">{stats.hands}</p>
          <p className="muted small">
            {stats.hintsUsed} hint{stats.hintsUsed === 1 ? '' : 's'} used.
          </p>
        </div>
      </section>

      <section className="profile-section">
        <h2>Playing style</h2>
        <StyleCard style={style} />
      </section>

      <section className="profile-section">
        <h2>Leaks</h2>
        <div className="review-grid">
          <StatsSection stats={stats} headline={false} />
          <CoachSection stats={stats} coach={review.isPending ? undefined : review.data?.coach ?? { status: 'unavailable', reason: review.error?.message ?? 'No review.' }} onRetry={() => review.refetch()} drillTitle="What to practise next" />
        </div>
      </section>

      <section className="profile-section">
        <h2>
          Starred decisions {starredCount > 0 && <span className="profile-count">{starredCount}</span>}
        </h2>
        <StarredList onOpen={onOpen} />
      </section>
    </>
  );
}

function StarredList({ onOpen }: { onOpen: (item: StarredDecision) => void }) {
  const starred = useInfiniteQuery({
    queryKey: ['starred'],
    queryFn: ({ pageParam }) => api.starred(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextBefore,
  });
  if (starred.isPending) return <CoachLoader label="Loading your starred decisions" />;
  if (starred.error) return <p className="error">{starred.error.message}</p>;
  const items = starred.data.pages.flatMap((p) => p.items);
  if (!items.length) return <p className="muted small">Star a decision from its verdict to keep it here.</p>;

  return (
    <>
      <ul className="starred-list">
        {items.map((item) => (
          <li key={item.decision.id}>
            <button className="starred-item" onClick={() => onOpen(item)}>
              <span className="mini-cards">
                {item.decision.heroCards.map((c) => (
                  <PlayingCard key={c} card={c} size="xs" />
                ))}
              </span>
              <span className="starred-text">
                <strong>{verdictTitle(item.decision)}</strong> <span className="muted">{item.decision.nodeLabel}</span>
                {item.decision.board.length > 0 && <span className="muted">on {item.decision.board.join(' ')}</span>}
                {item.note && <span className="starred-note">{item.note}</span>}
              </span>
              <span className="muted small">{new Date(item.starredAt).toLocaleDateString()}</span>
            </button>
          </li>
        ))}
      </ul>
      {starred.hasNextPage && (
        <button className="ghost" disabled={starred.isFetchingNextPage} onClick={() => starred.fetchNextPage()}>
          {starred.isFetchingNextPage ? 'Loading…' : 'Show more'}
        </button>
      )}
    </>
  );
}

/** One starred decision: its verdict (star and note editable), the chart, and its coach thread. */
function StarredDetail({ item, onClose }: { item: StarredDecision; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const close = () => {
    // The star or note may have changed here; refresh the list and count.
    void queryClient.invalidateQueries({ queryKey: ['starred'] });
    void queryClient.invalidateQueries({ queryKey: ['profile'] });
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <Backdrop onClose={close}>
      <div className="modal starred-detail" role="dialog" aria-modal="true" aria-label="Starred decision" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Starred decision</h2>
          <button className="link" onClick={close}>
            Close
          </button>
        </div>
        <VerdictBanner feedback={item.decision} handId={item.handId} />
        <RangeGrid nodeKey={item.decision.nodeKey} highlight={item.decision.handClass} />
        <CoachCard handId={item.handId} decision={item.decision} messages={messages} onMessages={setMessages} />
      </div>
    </Backdrop>
  );
}
