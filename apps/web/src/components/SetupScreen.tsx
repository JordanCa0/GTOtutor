import {
  SIX_MAX_POSITIONS,
  STACK_DEPTHS,
  TABLE_SIZES,
  type MixedStacks,
  type Position,
  type StackDepth,
  type StartHandRequest,
  type TableSize,
  type VillainStyle,
} from '@gtotutor/shared-types';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '../api/client';
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
const POSITION_ITEMS: JellyItem[] = [{ value: 'random', label: 'Random' }, ...SIX_MAX_POSITIONS.map((p) => ({ value: p, label: p }))];
const OPPONENT_ITEMS: JellyItem[] = [{ value: 'any', label: 'Anyone' }, ...SIX_MAX_POSITIONS.map((p) => ({ value: p, label: p }))];
const STYLE_ITEMS: JellyItem[] = [
  { value: 'gto', label: 'Charts' },
  { value: 'fish', label: 'Fish' },
  { value: 'nit', label: 'Nit' },
  { value: 'lag', label: 'LAG' },
  { value: 'tag', label: 'TAG' },
  { value: 'mixed', label: 'Mixed' },
];
const STYLE_TEXT: Record<VillainStyle, string> = {
  gto: 'Opponents play the charts.',
  fish: 'Fish play far too many hands, limp and call a lot, and rarely raise without a big hand.',
  nit: 'Nits play only strong hands and fold almost everything else.',
  lag: 'Loose-aggressive players play wide and raise and re-raise often.',
  tag: 'Tight-aggressive players play a fairly tight range, but raise rather than call.',
  mixed: 'Each opponent is a random player type: fish, nit, loose-aggressive or tight-aggressive.',
};

export function SetupScreen({ initial, starting, error, onStart, onClose }: Props) {
  const [tableSize, setTableSize] = useState<TableSize>(initial?.tableSize ?? 'SIX_MAX');
  const [stack, setStack] = useState<StackDepth | 'random'>(initial?.stackDepthBb ?? 100);
  const [position, setPosition] = useState<Position | 'random'>(initial?.heroPosition ?? 'random');
  const [rotate, setRotate] = useState(initial?.rotate ?? false);
  const [opponent, setOpponent] = useState<Position | 'any'>(initial?.opponentPosition ?? 'any');
  // An opponent needs hero in one fixed seat. The pick is kept while it doesn't apply, so turning
  // Rotate on and off again (or trying Random) doesn't lose it.
  const fixedSeat = position !== 'random' && !rotate;
  const activeOpponent = fixedSeat && opponent !== position ? opponent : 'any';
  const [skipEasyFolds, setSkipEasyFolds] = useState(initial?.skipEasyFolds ?? true);
  const [simplePots, setSimplePots] = useState(initial?.simplePots ?? false);
  const [villainStyle, setVillainStyle] = useState<VillainStyle>(initial?.villainStyle ?? 'gto');
  const [mix, setMix] = useState<MixedStacks | 'equal'>(initial?.mixedStacks ?? 'equal');

  // The depths the API's charts can deal (until it answers, the ones every build has).
  const options = useQuery({ queryKey: ['table-options'], queryFn: api.options, staleTime: Infinity });
  const depths = options.data?.stackDepths ?? STACK_DEPTHS.filter((s) => s.available).map((s) => s.id);
  const stackItems: JellyItem[] = [
    { value: 'random', label: 'Random', disabled: depths.length < 2 },
    ...STACK_DEPTHS.map((s) => {
      const ok = depths.includes(s.id);
      return { value: String(s.id), label: ok ? `${s.id}bb` : soon(`${s.id}bb`), disabled: !ok };
    }),
  ];
  // Random deals a new depth each hand, among those with charts for the chosen stacks.
  const mixedDepths = (kind: MixedStacks) => options.data?.mixedStacks[kind] ?? [];
  const mixedAvailable = (kind: MixedStacks) => (stack === 'random' ? mixedDepths(kind).length > 0 : mixedDepths(kind).includes(stack));
  const depthText = (kind: MixedStacks | 'equal') => {
    const ids = kind === 'equal' ? depths : mixedDepths(kind);
    return stack !== 'random' ? `${stack}bb` : ids.length > 1 ? `${ids.slice(0, -1).join(', ')} or ${ids.at(-1)}bb` : `${ids[0]}bb`;
  };
  // The stacks choice holds while it doesn't apply at the chosen depth, as the opponent does.
  const activeMix = mix !== 'equal' && mixedAvailable(mix) ? mix : 'equal';

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
        <JellyRadio {...JELLY_THEME} ariaLabel="Stack depth" items={stackItems} value={String(stack)} onChange={(v) => setStack(v === 'random' ? v : (Number(v) as StackDepth))} />
        {(mixedAvailable('one') || mixedAvailable('several')) && (
          <div className="setup-subtoggle setup-mix">
            <JellyRadio
              {...JELLY_THEME}
              ariaLabel="Stacks"
              items={[
                { value: 'equal', label: 'Equal stacks' },
                { value: 'one', label: 'One short', disabled: !mixedAvailable('one') },
                { value: 'several', label: 'Several short', disabled: !mixedAvailable('several') },
              ]}
              value={activeMix}
              onChange={(v) => setMix(v as MixedStacks | 'equal')}
            />
            <p className="muted small">
              {activeMix === 'equal'
                ? stack === 'random'
                  ? `Each hand deals a new depth, ${depthText('equal')}, and everyone starts with it.`
                  : `Everyone starts with ${stack}bb.`
                : activeMix === 'one'
                  ? `One seat starts shorter (${stack === 60 ? '20bb' : '20bb or 60bb'}) than the rest${stack === 'random' ? ` (${depthText('one')}, new each hand)` : ''}, so you see how a short stack changes the ranges around it.`
                  : `One seat starts with 20bb and two with 60bb; the rest have ${depthText('several')}. Each hand seats them differently.`}
            </p>
          </div>
        )}
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
        <label className="toggle setup-subtoggle">
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
        <legend>Player types</legend>
        <JellyRadio {...JELLY_THEME} ariaLabel="Player types" items={STYLE_ITEMS} value={villainStyle} onChange={(v) => setVillainStyle(v as VillainStyle)} />
        <p className="muted small">
          {STYLE_TEXT[villainStyle]}
          {villainStyle !== 'gto' && ' Your decisions are still graded against the charts and the solver.'}
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

      <button className="primary big" disabled={starting} onClick={() => onStart({ tableSize, stackDepthBb: stack, ...(activeMix !== 'equal' && { mixedStacks: activeMix }), heroPosition: position, rotate, ...(activeOpponent !== 'any' && { opponentPosition: activeOpponent }), skipEasyFolds, simplePots, ...(villainStyle !== 'gto' && { villainStyle }) })}>
        {starting ? 'Dealing…' : onClose ? 'Deal with these settings' : 'Deal a hand'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );

  if (!onClose) return card;
  return <Backdrop onClose={onClose}>{card}</Backdrop>;
}
