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
import { Backdrop } from './Presence';
import JellyRadio, { type JellyItem } from './reactbits/JellyRadio';

/** The setup's choices: a hand request, plus whether hero moves one seat each hand. */
export type DealSettings = StartHandRequest & { rotate?: boolean };

/** Hero's next seat when the button moves on, as at a real table: UTG → BB → SB → BTN → CO → HJ → UTG. */
const NEXT_SEAT: Record<Position, Position> = { UTG: 'BB', BB: 'SB', SB: 'BTN', BTN: 'CO', CO: 'HJ', HJ: 'UTG' };

/**
 * The request for the next hand. Rotating, the first hand sits at the chosen seat (or a random one)
 * and each later hand one seat on from `previous`.
 */
export function dealRequest(settings: DealSettings, previous: Position | null): StartHandRequest {
  const { rotate, ...req } = settings;
  if (!rotate) return req;
  const first = req.heroPosition === 'random' ? SIX_MAX_POSITIONS[Math.floor(Math.random() * SIX_MAX_POSITIONS.length)] : req.heroPosition;
  return { ...req, heroPosition: previous ? NEXT_SEAT[previous] : first };
}

interface Props {
  initial: DealSettings | null;
  starting: boolean;
  error: string | null;
  onStart: (settings: DealSettings) => void;
  /** When set, the setup opens as a popup over the current session and this returns to it. */
  onClose?: () => void;
}

const JELLY_THEME = {
  chipColor: '#1a212b',
  activeColor: '#ece7dc',
  textColor: '#e2ddd2',
  activeTextColor: '#0b0e12',
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
const OPPONENT_ITEMS: JellyItem[] = [{ value: 'any', label: 'Anyone' }, ...SIX_MAX_POSITIONS.map((p) => ({ value: p, label: p }))];

export function SetupScreen({ initial, starting, error, onStart, onClose }: Props) {
  const [tableSize, setTableSize] = useState<TableSize>(initial?.tableSize ?? 'SIX_MAX');
  const [stack, setStack] = useState<StackDepth>(initial?.stackDepthBb ?? 100);
  const [position, setPosition] = useState<Position | 'random'>(initial?.heroPosition ?? 'random');
  const [rotate, setRotate] = useState(initial?.rotate ?? false);
  const [opponent, setOpponent] = useState<Position | 'any'>(initial?.opponentPosition ?? 'any');
  // An opponent needs hero in one fixed seat. The pick is kept while it doesn't apply, so turning
  // Rotate on and off again (or trying Random) doesn't lose it.
  const fixedSeat = position !== 'random' && !rotate;
  const activeOpponent = fixedSeat && opponent !== position ? opponent : 'any';
  const [skipEasyFolds, setSkipEasyFolds] = useState(initial?.skipEasyFolds ?? true);
  const [simplePots, setSimplePots] = useState(initial?.simplePots ?? false);

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
          <p className="eyebrow">Preflop trainer for 6-max cash</p>
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
        <JellyRadio
          {...JELLY_THEME}
          ariaLabel="Your position"
          items={POSITION_ITEMS}
          value={position}
          onChange={(v) => setPosition(v as Position | 'random')}
        />
        <label className="toggle setup-rotate">
          <input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} />
          <span>
            Rotate positions
            <small>The button moves round the table after each hand, so your position moves one place earlier: BTN, then CO, HJ, UTG, BB, SB.</small>
          </span>
        </label>
      </fieldset>

      <fieldset>
        <legend>Opponent</legend>
        {!fixedSeat ? (
          // Greyed until hero has one fixed seat. The line below says why, so touch screens see it too.
          <JellyRadio {...JELLY_THEME} disabled ariaLabel="Opponent" items={OPPONENT_ITEMS} value="any" onChange={() => {}} />
        ) : (
          <JellyRadio
            {...JELLY_THEME}
            ariaLabel="Opponent"
            items={OPPONENT_ITEMS.filter((item) => typeof item === 'string' || item.value !== position)}
            value={activeOpponent}
            onChange={(v) => setOpponent(v as Position | 'any')}
          />
        )}
        {/* Always one line here, so switching Rotate or Random doesn't push the rest of the form around. */}
        <p className="muted small">
          {!fixedSeat
            ? position === 'random'
              ? 'Pick your position (and leave Rotate positions off) to choose an opponent.'
              : 'Turn off Rotate positions to choose an opponent.'
            : activeOpponent === 'any'
              ? 'Play the whole table as the charts deal it.'
              : `Every hand is you against the ${activeOpponent}, who always plays on; everyone else folds.`}
        </p>
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
          <input type="checkbox" checked={simplePots} onChange={(e) => setSimplePots(e.target.checked)} />
          <span>
            Simple pots
            <small>
              Opponents fold instead of limping or calling before you act, so you can always call a raise. Turn it off for the full game: once
              someone has called or limped in front of you, you can only raise or fold, since every pot stays heads-up.
            </small>
          </span>
        </label>
      </fieldset>

      <p className="muted small">Cash game only for now. Tournament/ICM, other table sizes, and other stack depths come with the solver.</p>

      <button className="primary big" disabled={starting} onClick={() => onStart({ tableSize, stackDepthBb: stack, heroPosition: position, rotate, ...(activeOpponent !== 'any' && { opponentPosition: activeOpponent }), skipEasyFolds, simplePots })}>
        {starting ? 'Dealing…' : onClose ? 'Deal with these settings' : 'Deal a hand'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );

  if (!onClose) return card;
  return <Backdrop onClose={onClose}>{card}</Backdrop>;
}
