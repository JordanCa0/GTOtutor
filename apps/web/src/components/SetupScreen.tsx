import {
  SIX_MAX_POSITIONS,
  STACK_DEPTHS,
  TABLE_SIZES,
  type Position,
  type StackDepth,
  type StartHandRequest,
  type TableSize,
} from '@gtotutor/shared-types';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import JellyRadio, { type JellyItem } from './reactbits/JellyRadio';

interface Props {
  initial: StartHandRequest | null;
  starting: boolean;
  error: string | null;
  onStart: (req: StartHandRequest) => void;
  /** When set, the setup opens as a popup over the current session and this returns to it. */
  onClose?: () => void;
}

const JELLY_THEME = {
  chipColor: '#1a212b',
  activeColor: '#d4af6a',
  textColor: '#e2ddd2',
  activeTextColor: '#1b1307',
  size: 'md' as const,
};

const soon = (label: string) => (
  <>
    {label}
    <small className="soon">soon</small>
  </>
);

const TABLE_ITEMS: JellyItem[] = TABLE_SIZES.map((t) => ({ value: t.id, label: t.available ? t.label : soon(t.label), disabled: !t.available }));
const STACK_ITEMS: JellyItem[] = STACK_DEPTHS.map((s) => ({ value: String(s.id), label: s.available ? `${s.id}bb` : soon(`${s.id}bb`), disabled: !s.available }));
const POSITION_ITEMS: JellyItem[] = [{ value: 'random', label: 'Random' }, ...SIX_MAX_POSITIONS.map((p) => ({ value: p, label: p }))];

export function SetupScreen({ initial, starting, error, onStart, onClose }: Props) {
  const [tableSize, setTableSize] = useState<TableSize>(initial?.tableSize ?? 'SIX_MAX');
  const [stack, setStack] = useState<StackDepth>(initial?.stackDepthBb ?? 100);
  const [position, setPosition] = useState<Position | 'random'>(initial?.heroPosition ?? 'random');
  const [skipEasyFolds, setSkipEasyFolds] = useState(initial?.skipEasyFolds ?? true);
  const [flopPractice, setFlopPractice] = useState(initial?.flopPractice ?? false);

  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const card = (
    <div className={`setup ${onClose ? 'setup-modal' : ''}`} role={onClose ? 'dialog' : undefined} aria-modal={onClose ? true : undefined} aria-label={onClose ? 'Configure game' : undefined} onClick={(e) => e.stopPropagation()}>
      {onClose ? (
        <div className="setup-head">
          <div>
            <p className="eyebrow">Configure game</p>
            <h2>Table, stacks &amp; seat</h2>
          </div>
          <button className="ghost" onClick={onClose}>
            Back to hand
          </button>
        </div>
      ) : (
        <>
          <p className="eyebrow">Preflop trainer · 6-max cash</p>
          <h1 className="brand">
            GTO<span>tutor</span>
          </h1>
          <p className="tagline">Play preflop spots hand by hand. Every decision is graded against the range chart, and an AI coach explains why.</p>
        </>
      )}

      <fieldset>
        <legend>Table</legend>
        <JellyRadio {...JELLY_THEME} ariaLabel="Table size" items={TABLE_ITEMS} value={tableSize} onChange={(v) => setTableSize(v as TableSize)} />
      </fieldset>

      <fieldset>
        <legend>Stack depth</legend>
        <JellyRadio {...JELLY_THEME} ariaLabel="Stack depth" items={STACK_ITEMS} value={String(stack)} onChange={(v) => setStack(Number(v) as StackDepth)} />
      </fieldset>

      <fieldset>
        <legend>Your position</legend>
        <JellyRadio {...JELLY_THEME} ariaLabel="Your position" items={POSITION_ITEMS} value={position} onChange={(v) => setPosition(v as Position | 'random')} />
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
        <label className="toggle">
          <input type="checkbox" checked={flopPractice} onChange={(e) => setFlopPractice(e.target.checked)} />
          <span>
            Flop practice (testing)
            <small>Every hand starts at a BTN vs BB flop. You play BTN or BB (picked at random unless you chose one); preflop is skipped.</small>
          </span>
        </label>
      </fieldset>

      <p className="muted small">Cash game only for now. Tournament/ICM, other table sizes, and other stack depths come with the solver.</p>

      <button className="primary big" disabled={starting} onClick={() => onStart({ tableSize, stackDepthBb: stack, heroPosition: position, skipEasyFolds, flopPractice })}>
        {starting ? 'Dealing…' : onClose ? 'Deal with these settings' : 'Deal a hand'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );

  if (!onClose) return card;
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      {card}
    </div>,
    document.body,
  );
}
