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
import { StyleChart } from './StyleChart';
import { VerdictBanner, verdictTitle } from './VerdictBanner';

const pct = (f: number) => `${Math.round(f * 100)}%`;

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
        <div className="profile-head">
          <div>
            <p className="eyebrow">Profile</p>
            <h1>{session ? displayName(session) : 'Your profile'}</h1>
          </div>
          <button className="secondary" onClick={onClose}>
            Back to the table
          </button>
        </div>
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

  return (
    <>
      <section className="profile-summary">
        <div>
          <p className="big-stat">{pct(gto.accuracy)}</p>
          <p className="muted small">of {stats.decisions} decisions matched the charts or solver (best or mixed play)</p>
        </div>
        <div>
          <p className="big-stat">{gto.evLossBb === null ? '–' : `${gto.evLossBb.toFixed(2)}bb`}</p>
          <p className="muted small">{gto.evLossBb === null ? 'EV lost per decision: needs decisions with EVs (flop spots or solved charts)' : `EV lost per decision, over the ${gto.evDecisions} decisions with EVs`}</p>
        </div>
        <div>
          <p className="big-stat">{stats.hands}</p>
          <p className="muted small">hands with a decision</p>
        </div>
      </section>

      <section className="profile-section">
        <h2>Your playing style</h2>
        <StyleChart style={style} />
      </section>

      <section className="profile-section">
        <h2>Biggest leaks</h2>
        <div className="review-grid">
          <StatsSection stats={stats} />
          <CoachSection stats={stats} coach={review.isPending ? undefined : review.data?.coach ?? { status: 'unavailable', reason: review.error?.message ?? 'No review.' }} onRetry={() => review.refetch()} drillTitle="What to practise next" />
        </div>
      </section>

      <section className="profile-section">
        <h2>Starred decisions {starredCount > 0 && <span className="muted small">({starredCount})</span>}</h2>
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
                {item.decision.board.length > 0 && <span className="muted"> · board {item.decision.board.join(' ')}</span>}
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
