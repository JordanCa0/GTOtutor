import {
  SIX_MAX_POSITIONS,
  STACK_DEPTHS,
  TABLE_SIZES,
  type Position,
  type StackDepth,
  type StartHandRequest,
  type TableSize,
} from '@gtotutor/shared-types';
import { useState } from 'react';

interface Props {
  initial: StartHandRequest | null;
  starting: boolean;
  error: string | null;
  onStart: (req: StartHandRequest) => void;
}

export function SetupScreen({ initial, starting, error, onStart }: Props) {
  const [tableSize, setTableSize] = useState<TableSize>(initial?.tableSize ?? 'SIX_MAX');
  const [stack, setStack] = useState<StackDepth>(initial?.stackDepthBb ?? 100);
  const [position, setPosition] = useState<Position | 'random'>(initial?.heroPosition ?? 'random');
  const [skipEasyFolds, setSkipEasyFolds] = useState(initial?.skipEasyFolds ?? true);

  return (
    <div className="setup">
      <p className="eyebrow">Preflop trainer · 6-max cash</p>
      <h1 className="brand">
        GTO<span>tutor</span>
      </h1>
      <p className="tagline">Play preflop spots hand by hand. Every decision is graded against the range chart, and an AI coach explains why.</p>

      <fieldset>
        <legend>Table</legend>
        <div className="chips">
          {TABLE_SIZES.map((t) => (
            <button key={t.id} className={`chip ${tableSize === t.id ? 'on' : ''}`} disabled={!t.available} onClick={() => setTableSize(t.id)}>
              {t.label}
              {!t.available && <small>soon</small>}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Stack depth</legend>
        <div className="chips">
          {STACK_DEPTHS.map((s) => (
            <button key={s.id} className={`chip ${stack === s.id ? 'on' : ''}`} disabled={!s.available} onClick={() => setStack(s.id)}>
              {s.id}bb
              {!s.available && <small>soon</small>}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Your position</legend>
        <div className="chips">
          {(['random', ...SIX_MAX_POSITIONS] as const).map((p) => (
            <button key={p} className={`chip ${position === p ? 'on' : ''}`} onClick={() => setPosition(p)}>
              {p === 'random' ? 'Random' : p}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Hands</legend>
        <label className="toggle">
          <input type="checkbox" checked={skipEasyFolds} onChange={(e) => setSkipEasyFolds(e.target.checked)} />
          <span>
            Skip easy folds
            <small>Mostly deal spots with a real decision; an obvious fold still shows up now and then.</small>
          </span>
        </label>
      </fieldset>

      <p className="muted small">Cash game only for now. Tournament/ICM, other table sizes, and other stack depths come with the solver.</p>

      <button className="primary big" disabled={starting} onClick={() => onStart({ tableSize, stackDepthBb: stack, heroPosition: position, skipEasyFolds })}>
        {starting ? 'Dealing…' : 'Deal a hand'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
