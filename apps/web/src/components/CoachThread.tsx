import { CHAT_LIMITS, type ChatMessage } from '@gtotutor/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';

const SUGGESTIONS = ["Why is that the chart's play?", 'What range is my opponent likely on here?', 'How would this change from a different position?'];

interface Props {
  handId: string;
  decisionId: string;
  messages: ChatMessage[];
  onMessages: (messages: ChatMessage[]) => void;
  variant: 'panel' | 'reader';
}

/** The coach's explanation followed by the follow-up conversation, with the question box pinned below. */
export function CoachThread({ handId, decisionId, messages, onMessages, variant }: Props) {
  const queryKey = ['explanation', decisionId];
  // Analysis is on demand (each one is a paid API call); once requested it's shared with the reading view.
  const [requested, setRequested] = useState(false);
  const state = useQueryClient().getQueryState(queryKey);
  const alreadyStarted = !!state && (state.data !== undefined || state.fetchStatus === 'fetching' || state.error !== null);
  const explanation = useQuery({
    queryKey,
    queryFn: () => api.explanation(handId, decisionId),
    enabled: requested || alreadyStarted,
  });
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const atLimit = messages.filter((m) => m.role === 'user').length >= CHAT_LIMITS.maxUserTurns;

  const send = useMutation({
    mutationFn: (question: string) => api.chat(handId, decisionId, [...messages, { role: 'user', content: question }]),
    onSuccess: (res, question) => {
      if (res.status === 'unavailable') {
        setNotice(res.reason);
        return;
      }
      setNotice(res.ungroundedNumbers.length ? `This answer mentions ${res.ungroundedNumbers.join(', ')}, which isn't in the chart data.` : null);
      onMessages([...messages, { role: 'user', content: question }, { role: 'assistant', content: res.reply }]);
      setDraft('');
    },
    onError: (err) => setNotice(err.message),
  });

  useEffect(() => {
    if (messages.length || send.isPending) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, send.isPending]);

  const ask = (q: string) => {
    const question = q.trim();
    if (!question || send.isPending || atLimit) return;
    setNotice(null);
    send.mutate(question);
  };

  const data = explanation.data;
  const retry = (
    <button className="link" onClick={() => explanation.refetch()}>
      Retry
    </button>
  );

  return (
    <div className={`thread thread-${variant}`}>
      <div className="thread-scroll">
        {explanation.isFetching ? (
          <div className="coach-loading">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
            Coach is reviewing the spot…
          </div>
        ) : explanation.error ? (
          <p className="error small">
            {explanation.error.message} {retry}
          </p>
        ) : data?.status === 'unavailable' ? (
          <p className="muted small">
            Coach unavailable: {data.reason} {retry}
          </p>
        ) : data ? (
          <article className="coach-message">
            <p className="tldr">
              <span className="tldr-label">TL;DR</span>
              {data.tldr}
            </p>
            <ul className="points">
              {data.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            {data.ungroundedNumbers.length > 0 && (
              <p className="warn small">
                Heads up: this mentions {data.ungroundedNumbers.join(', ')}, which isn't in the chart data. Trust the chart numbers. {retry}
              </p>
            )}
          </article>
        ) : (
          <div className="analyze">
            <button className="primary" onClick={() => setRequested(true)}>
              Analyze this decision
            </button>
            <span className="muted small">Get a quick TL;DR and the key reasons, or just ask a question below.</span>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.content}
          </div>
        ))}
        {send.isPending && (
          <div className="bubble assistant">
            <span className="dots">
              <i />
              <i />
              <i />
            </span>
          </div>
        )}
        {messages.length === 0 && !explanation.isFetching && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => ask(s)} disabled={send.isPending}>
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={endRef} className="thread-end" />
      </div>

      {notice && <p className="notice small">{notice}</p>}
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          ask(draft);
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={CHAT_LIMITS.maxUserChars}
          placeholder={atLimit ? 'Question limit reached for this decision' : 'Ask the coach a follow-up…'}
          disabled={atLimit}
          aria-label="Ask the coach a follow-up question"
        />
        <button className="primary" disabled={!draft.trim() || send.isPending || atLimit}>
          Ask
        </button>
      </form>
    </div>
  );
}
