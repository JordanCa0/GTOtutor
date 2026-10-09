import { CHAT_LIMITS, type ChatMessage } from '@gtotutor/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { CoachLoader } from './CoachLoader';

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
  const queryClient = useQueryClient();
  // Analysis is on demand (each one is a paid API call); once requested it's shared with the reading view.
  const [requested, setRequested] = useState(false);
  const state = queryClient.getQueryState(queryKey);
  const alreadyStarted = !!state && (state.data !== undefined || state.fetchStatus === 'fetching' || state.error !== null);
  const explanation = useQuery({
    queryKey,
    queryFn: () => api.explanation(handId, decisionId),
    enabled: requested || alreadyStarted,
  });
  // A thread saved earlier (before a reload, or on another device) comes back without asking the coach again.
  const saved = useQuery({
    queryKey: ['coach-thread', decisionId],
    queryFn: () => api.coachThread(handId, decisionId),
    staleTime: Infinity,
  });
  useEffect(() => {
    if (!saved.data) return;
    if (saved.data.explanation && queryClient.getQueryData(queryKey) === undefined) queryClient.setQueryData(queryKey, saved.data.explanation);
    if (saved.data.messages.length && messages.length === 0) onMessages(saved.data.messages);
    // Only when the saved thread arrives; later changes are this component's own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.data]);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Grow the box with its text (CSS caps the height, then it scrolls).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [draft]);
  const [notice, setNotice] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const atLimit = messages.filter((m) => m.role === 'user').length >= CHAT_LIMITS.maxUserTurns;

  const send = useMutation({
    mutationFn: (question: string) => api.chat(handId, decisionId, [...messages, { role: 'user', content: question }]),
    onSuccess: (res, question) => {
      if (res.status === 'unavailable') {
        setNotice(res.reason);
        restoreDraft(question);
        return;
      }
      setNotice(res.ungroundedNumbers.length ? `This answer mentions ${res.ungroundedNumbers.join(', ')}, which isn't in the chart data.` : null);
      onMessages([...messages, { role: 'user', content: question }, { role: 'assistant', content: res.reply.trim(), ...(res.tldr ? { tldr: res.tldr } : {}) }]);
    },
    onError: (err, question) => {
      setNotice(err.message);
      restoreDraft(question);
    },
  });

  // A question that got no answer goes back in the box so it can be resent (unless something new was typed).
  const restoreDraft = (question: string) => setDraft((d) => d || question);

  useEffect(() => {
    if (messages.length || send.isPending) endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, send.isPending]);

  const ask = (q: string) => {
    const question = q.trim();
    if (!question || send.isPending || atLimit) return;
    setNotice(null);
    // The question shows in the conversation right away (see the pending bubble below), so clear the box.
    setDraft('');
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
            <CoachLoader label="Coach is analyzing" />
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
            {m.tldr && (
              <p className="bubble-tldr">
                <span className="tldr-label">TL;DR</span>
                <strong>{m.tldr}</strong>
              </p>
            )}
            {m.content}
          </div>
        ))}
        {send.isPending && (
          <>
            <div className="bubble user">{send.variables}</div>
            <div className="bubble assistant thinking">
              <CoachLoader label="Coach is thinking" />
            </div>
          </>
        )}
        {messages.length === 0 && !explanation.isFetching && !send.isPending && (
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
          placeholder={atLimit ? 'Question limit reached for this decision' : 'Ask the coach a follow-up…'}
          disabled={atLimit}
          aria-label="Ask the coach a follow-up question"
        />
        <button className="secondary" disabled={!draft.trim() || send.isPending || atLimit}>
          Ask
        </button>
      </form>
    </div>
  );
}
