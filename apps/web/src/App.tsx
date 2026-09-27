import type { ActionType, DecisionFeedback, HandView, StartHandRequest } from '@gtotutor/shared-types';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from './api/client';
import { ActionLog } from './components/ActionLog';
import { FeedbackPanel } from './components/FeedbackPanel';
import { HandSummary } from './components/HandSummary';
import { SetupScreen } from './components/SetupScreen';
import { Table } from './components/Table';

export function App() {
  const [settings, setSettings] = useState<StartHandRequest | null>(null);
  const [hand, setHand] = useState<HandView | null>(null);
  const [lastFeedback, setLastFeedback] = useState<DecisionFeedback | null>(null);

  const start = useMutation({
    mutationFn: api.startHand,
    onSuccess: (h) => {
      setHand(h);
      setLastFeedback(null);
    },
  });

  const decide = useMutation({
    mutationFn: (action: ActionType) => api.decide(hand!.id, action),
    onSuccess: ({ hand: h, feedback }) => {
      setHand(h);
      setLastFeedback(feedback);
    },
  });

  const deal = (req: StartHandRequest) => {
    setSettings(req);
    start.mutate(req);
  };

  if (!hand) {
    return <SetupScreen initial={settings} starting={start.isPending} error={start.error?.message ?? null} onStart={deal} />;
  }

  const complete = hand.status === 'complete';

  return (
    <div className="play">
      <header>
        <strong className="brand">GTOtutor</strong>
        <span className="muted">
          6-max cash · {hand.config.stackDepthBb}bb · you are <b>{hand.heroPosition}</b>
        </span>
        <button className="link" onClick={() => setHand(null)}>
          Change settings
        </button>
      </header>

      {hand.dataSource.kind === 'fixture' && <div className="banner">{hand.dataSource.note}</div>}

      <main>
        <section className="left">
          <Table hand={hand} />
          {!complete && (
            <div className="actions">
              {hand.legalActions.map((a) => (
                <button key={a.id} className={`act act-${a.id}`} disabled={decide.isPending} onClick={() => decide.mutate(a.id)}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {decide.error && <p className="error">{decide.error.message}</p>}
          {complete && settings && <HandSummary key={hand.id} hand={hand} onNext={() => start.mutate(settings)} />}
        </section>

        <aside className="right">
          <h3>Action</h3>
          <ActionLog entries={hand.actionLog} />
          {lastFeedback && !complete && (
            <>
              <h3>Last decision</h3>
              <FeedbackPanel key={lastFeedback.id} handId={hand.id} feedback={lastFeedback} />
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
