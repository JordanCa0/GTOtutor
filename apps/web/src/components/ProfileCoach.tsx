import { CHAT_LIMITS, type ChatMessage, type SessionCoachReview, type SessionStats } from '@gtotutor/shared-types';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { CoachLoader } from './CoachLoader';
import { useTypewriter } from './useTypewriter';

const SUGGESTIONS = ['What should I work on first?', 'Why is that my biggest leak?', 'How should I practise this?'];

type Review = Extract<SessionCoachReview, { status: 'ok' }>;

/**
 * The profile page's coach: a short brief typed out first, then the full write-up or questions on
 * request. `coach` is undefined while it loads.
 */
export function ProfileCoach({ stats, coach, onRetry }: { stats: SessionStats; coach: SessionCoachReview | undefined; onRetry: () => void }) {
  return (
    <section className="review-coach">
      <h3>Coach's take</h3>
      {!coach ? (
        <CoachLoader label="The coach is reading your hands" />
      ) : coach.status === 'not_enough_data' ? (
        <p className="muted small">
          Play {coach.needed} more decision{coach.needed > 1 ? 's' : ''} for the coach's written review.
        </p>
      ) : coach.status === 'unavailable' ? (
        <p className="muted small">
          Coach unavailable: {coach.reason}{' '}
          <button className="link" onClick={onRetry}>
            Retry
          </button>
        </p>
      ) : (
        <ReviewBody stats={stats} coach={coach} />
      )}
    </section>
  );
}

function ReviewBody({ stats, coach }: { stats: SessionStats; coach: Review }) {
  const [more, setMore] = useState(false);
  const [asking, setAsking] = useState(false);
  // Reviews written before the brief existed open on their summary instead.
  const brief = coach.brief ?? coach.summary;
  const typed = useTypewriter([brief]);

  return (
    <>
      <Typed text={brief} shown={typed.shown[0]} done={typed.done} onSkip={typed.finish} className="review-brief" />
      {typed.done && (
        <div className="coach-actions">
          {!more && (
            <button className="secondary" onClick={() => setMore(true)}>
              Tell me more
            </button>
          )}
          {!asking && (
            <button className="secondary" onClick={() => setAsking(true)}>
              Ask the coach
            </button>
          )}
        </div>
      )}
      {more && <FullReview stats={stats} coach={coach} skipSummary={!coach.brief} />}
      {asking && <ReviewChat />}
    </>
  );
}

/** Text being typed out: a click shows the rest. Screen readers get the whole text at once. */
function Typed({ text, shown, done, onSkip, className, as: Tag = 'p' }: { text: string; shown: string; done: boolean; onSkip: () => void; className?: string; as?: 'p' | 'span' }) {
  if (!shown && !done) return null;
  return (
    <Tag className={className} onClick={done ? undefined : onSkip}>
      <span aria-hidden>{shown}</span>
      {!done && shown.length < text.length && <span className="type-caret" aria-hidden />}
      <span className="sr-only">{text}</span>
    </Tag>
  );
}

function FullReview({ stats, coach, skipSummary }: { stats: SessionStats; coach: Review; skipSummary: boolean }) {
  const texts = [skipSummary ? '' : coach.summary, ...coach.leaks.flatMap((l) => [l.title, l.advice]), coach.drill];
  const { shown, done, finish } = useTypewriter(texts);
  const part = (i: number) => ({ text: texts[i], shown: shown[i], done: done || shown[i].length === texts[i].length, onSkip: finish });
  const drillAt = texts.length - 1;
  return (
    <div className="review-more">
      {stats.leaks.length > 0 && (
        <ul className="leak-list">
          {stats.leaks.map((l) => (
            <li key={l.type}>
              {l.label} <b>×{l.count}</b>
            </li>
          ))}
        </ul>
      )}
      {!skipSummary && <Typed {...part(0)} />}
      {coach.leaks.map((l, k) =>
        shown[1 + 2 * k] ? (
          <div key={l.title} className="leak">
            <strong>
              <Typed {...part(1 + 2 * k)} as="span" />
            </strong>
            <Typed {...part(2 + 2 * k)} />
          </div>
        ) : null,
      )}
      {shown[drillAt] && (
        <div className="drill">
          <strong>What to practise next</strong>
          <Typed {...part(drillAt)} />
        </div>
      )}
    </div>
  );
}

/** Questions about the review. The conversation stays on the page; it isn't saved. */
function ReviewChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atLimit = messages.filter((m) => m.role === 'user').length >= CHAT_LIMITS.maxUserTurns;

  useEffect(() => inputRef.current?.focus(), []);

  const send = useMutation({
    mutationFn: (question: string) => api.profileReviewChat([...messages, { role: 'user', content: question }]),
    onSuccess: (res, question) => {
      if (res.status === 'unavailable') {
        setNotice(res.reason);
        setDraft((d) => d || question);
        return;
      }
      setNotice(res.ungroundedNumbers.length ? `This answer mentions ${res.ungroundedNumbers.join(', ')}, which isn't in your stats.` : null);
      setMessages([...messages, { role: 'user', content: question }, { role: 'assistant', content: res.reply.trim(), ...(res.tldr ? { tldr: res.tldr } : {}) }]);
    },
    onError: (err, question) => {
      setNotice(err.message);
      setDraft((d) => d || question);
    },
  });

  const ask = (q: string) => {
    const question = q.trim();
    if (!question || send.isPending || atLimit) return;
    setNotice(null);
    setDraft('');
    send.mutate(question);
  };

  return (
    <div className="review-chat">
      {messages.map((m, i) =>
        m.role === 'assistant' ? <Reply key={i} message={m} typing={i === messages.length - 1} /> : (
          <div key={i} className="bubble user">
            {m.content}
          </div>
        ),
      )}
      {send.isPending && (
        <>
          <div className="bubble user">{send.variables}</div>
          <div className="bubble assistant thinking">
            <CoachLoader label="Coach is thinking" />
          </div>
        </>
      )}
      {messages.length === 0 && !send.isPending && (
        <div className="suggestions">
          {SUGGESTIONS.map((s) => (
            <button key={s} className="suggestion" onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {notice && <p className="notice small">{notice}</p>}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter adds a line.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          maxLength={CHAT_LIMITS.maxUserChars}
          placeholder={atLimit ? 'Question limit reached' : 'Ask about your review…'}
          disabled={atLimit}
          aria-label="Ask the coach about your review"
        />
        <button className="secondary" disabled={!draft.trim() || send.isPending || atLimit}>
          Ask
        </button>
      </form>
    </div>
  );
}

/** A coach answer; the newest one types out. */
function Reply({ message, typing }: { message: ChatMessage; typing: boolean }) {
  const texts = [message.tldr ?? '', message.content];
  const { shown, done, finish } = useTypewriter(texts, !typing);
  return (
    <div className="bubble assistant" onClick={done ? undefined : finish}>
      {message.tldr && (
        <p className="bubble-tldr">
          <span className="tldr-label">TL;DR</span>
          <strong aria-hidden>{shown[0]}</strong>
          <span className="sr-only">{message.tldr}</span>
        </p>
      )}
      <span aria-hidden>{shown[1]}</span>
      {!done && <span className="type-caret" aria-hidden />}
      <span className="sr-only">{message.content}</span>
    </div>
  );
}
