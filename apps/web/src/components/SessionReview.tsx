import type { SessionCoachReview, SessionStats } from "@gtotutor/shared-types";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../api/client";
import { CoachLoader } from "./CoachLoader";
import { PlayingCard } from "./PlayingCard";
import { Backdrop } from "./Presence";
import { Skeleton, SkeletonGroup, useSkeleton } from "./Skeleton";

const pct = (n: number, d: number) =>
  d ? `${Math.round((n / d) * 100)}%` : "—";

/** How often a spot matched the chart, as a status colour: 70% and up good, 50% and up mixed, below that bad. */
const rateClass = (n: number, d: number) =>
  !d ? undefined : n / d >= 0.7 ? "rate-good" : n / d >= 0.5 ? "rate-ok" : "rate-bad";

interface Props {
  sessionId: string;
  decisionsPlayed: number;
  onClose: () => void;
  onNewSession: () => void;
}

export function SessionReview({
  sessionId,
  decisionsPlayed,
  onClose,
  onNewSession,
}: Props) {
  // The numbers come back at once; the coach's write-up (a paid call) arrives on its own.
  const stats = useQuery({
    queryKey: ["session-stats", sessionId, decisionsPlayed],
    queryFn: () => api.sessionStats(sessionId),
  });
  const review = useQuery({
    queryKey: ["review", sessionId, decisionsPlayed],
    queryFn: () => api.review(sessionId),
  });
  const skeleton = useSkeleton(stats.isPending);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <Backdrop onClose={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Session review"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>Session review</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </div>
        {skeleton.active || stats.isPending ? (
          <ReviewSkeleton visible={skeleton.visible} />
        ) : stats.error ? (
          <p className="error">{stats.error.message}</p>
        ) : (
          <ReviewBody
            stats={stats.data.stats}
            coach={
              review.isPending
                ? undefined
                : (review.data?.coach ?? {
                    status: "unavailable",
                    reason: review.error?.message ?? "No review.",
                  })
            }
            onRetry={() => review.refetch()}
          />
        )}
        <div className="modal-foot">
          <button className="secondary" onClick={onNewSession}>
            Start a new session
          </button>
        </div>
      </div>
    </Backdrop>
  );
}

/** The review's shape while the numbers load: headline, grade bar and the by-spot table. */
function ReviewSkeleton({ visible }: { visible: boolean }) {
  return (
    <SkeletonGroup visible={visible} label="Reviewing your session" className="review-grid">
      <div className="skeleton-stack">
        <Skeleton width="45%" height="2.2rem" />
        <Skeleton height="0.6rem" />
        <Skeleton width="80%" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height="1.6rem" />
        ))}
      </div>
      <div className="skeleton-stack">
        <Skeleton width="35%" height="1.2rem" />
        {[90, 75, 85].map((w) => (
          <Skeleton key={w} width={`${w}%`} />
        ))}
      </div>
    </SkeletonGroup>
  );
}

function ReviewBody({
  stats,
  coach,
  onRetry,
}: {
  stats: SessionStats;
  coach: SessionCoachReview | undefined;
  onRetry: () => void;
}) {
  if (stats.decisions === 0)
    return (
      <p className="muted">
        Play a few hands and your review will show up here.
      </p>
    );
  return (
    <div className="review-grid">
      <StatsSection stats={stats} />
      <CoachSection stats={stats} coach={coach} onRetry={onRetry} />
    </div>
  );
}

/**
 * Grades, the by-spot table, and the biggest mistakes (session review and profile page). The profile
 * shows its own accuracy summary, so it passes `headline={false}`.
 */
export function StatsSection({
  stats,
  headline = true,
}: {
  stats: SessionStats;
  headline?: boolean;
}) {
  const g = stats.grades;
  return (
    <section className={headline ? undefined : "stats-plain"}>
      {headline && (
        <>
          <p className="big-stat">
            {pct(g.best, stats.decisions)}{" "}
            <span className="muted small">
              of {stats.decisions} decisions matched the chart
            </span>
          </p>
          <div className="grade-bar">
            <span className="good" style={{ flex: g.best }} />
            <span className="ok" style={{ flex: g.mixed }} />
            <span className="bad" style={{ flex: g.mistake }} />
          </div>
          <p className="muted small">
            {stats.hands} hands · {g.best} best · {g.mixed} mixed ·{" "}
            {g.mistake} mistake{g.mistake === 1 ? "" : "s"} · {stats.hintsUsed}{" "}
            hint
            {stats.hintsUsed === 1 ? "" : "s"} used
            {stats.easyFoldsSkipped &&
              " · easy folds were mostly skipped, so this skews toward harder spots"}
          </p>
        </>
      )}

      <h3>By spot</h3>
      <table className="spot-table">
        <thead>
          <tr>
            <th>Spot</th>
            <th>Decisions</th>
            <th>Matched</th>
            <th>Mistakes</th>
          </tr>
        </thead>
        <tbody>
          {stats.bySpot.map((s) => (
            <tr key={s.spot}>
              <td>{s.label}</td>
              <td>{s.decisions}</td>
              <td className={rateClass(s.best, s.decisions)}>
                {pct(s.best, s.decisions)}
              </td>
              <td>{s.mistakes}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {stats.worstMistakes.length > 0 && (
        <>
          <h3>Biggest mistakes</h3>
          <ul className="mistakes">
            {stats.worstMistakes.map((m, i) => (
              <li key={i}>
                <span className="mini-cards">
                  {m.heroCards.map((c) => (
                    <PlayingCard key={c} card={c} size="xs" />
                  ))}
                </span>
                <span>
                  {m.nodeLabel}: you chose <b>{m.chosenLabel}</b> (
                  {Math.round(m.chosenFrequency * 100)}%), chart plays{" "}
                  <b>{m.bestLabel}</b> ({Math.round(m.bestFrequency * 100)}%)
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Leak counts and the coach's written review; `coach` undefined while it loads. */
export function CoachSection({
  stats,
  coach,
  onRetry,
  drillTitle = "Next session drill",
}: {
  stats: SessionStats;
  coach: SessionCoachReview | undefined;
  onRetry: () => void;
  drillTitle?: string;
}) {
  return (
    <section className="review-coach">
      <h3>Coach's take</h3>
      {stats.leaks.length > 0 && (
        <ul className="leak-list">
          {stats.leaks.map((l) => (
            <li key={l.type}>
              {l.label} <b>×{l.count}</b>
            </li>
          ))}
        </ul>
      )}
      {!coach ? (
        <CoachLoader label="The coach is reading your hands" />
      ) : coach.status === "not_enough_data" ? (
        <p className="muted small">
          Play {coach.needed} more decision{coach.needed > 1 ? "s" : ""} for the
          coach's written review.
        </p>
      ) : coach.status === "unavailable" ? (
        <p className="muted small">
          Coach unavailable: {coach.reason}{" "}
          <button className="link" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : (
        <>
          <p>{coach.summary}</p>
          {coach.leaks.map((l) => (
            <div key={l.title} className="leak">
              <strong>{l.title}</strong>
              <p>{l.advice}</p>
            </div>
          ))}
          <div className="drill">
            <strong>{drillTitle}</strong>
            <p>{coach.drill}</p>
          </div>
        </>
      )}
    </section>
  );
}
