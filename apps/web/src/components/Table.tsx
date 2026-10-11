import type { ActionLogEntry, HandView, Position } from '@gtotutor/shared-types';
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { actingAt, potAt, seatsAt, type PlaybackState } from '../playback';
import { ChipStack } from './ChipStack';
import { PlayingCard } from './PlayingCard';
import { POSITION_INFO } from '../positions';
import { useSettings } from '../settings';
import { ChipRain, type Celebration } from './Streak';

interface Point {
  x: number;
  y: number;
}

type Shape = 'wide' | 'tall';

/** Where everything sits (% of the table box) on a wide table and on a tall one (a phone held upright). */
interface Layout {
  /** Seat anchors, clockwise from hero at the bottom; action moves clockwise. */
  slots: Point[];
  center: Point;
  pot: Point;
  potLabel: Point;
  board: Point;
}
const LAYOUTS: Record<Shape, Layout> = {
  wide: {
    slots: [
      { x: 50, y: 85 },
      { x: 10, y: 68 },
      { x: 10, y: 27 },
      { x: 50, y: 9 },
      { x: 90, y: 27 },
      { x: 90, y: 68 },
    ],
    center: { x: 50, y: 48 },
    pot: { x: 50, y: 41 },
    potLabel: { x: 50, y: 34 },
    board: { x: 50, y: 54 },
  },
  tall: {
    slots: [
      { x: 50, y: 86 },
      { x: 15, y: 65 },
      { x: 15, y: 31 },
      { x: 50, y: 9 },
      { x: 85, y: 31 },
      { x: 85, y: 65 },
    ],
    center: { x: 50, y: 48 },
    pot: { x: 50, y: 42 },
    potLabel: { x: 50, y: 37 },
    board: { x: 50, y: 50 },
  },
};
/** The table size (px) each layout is drawn for: a smaller table scales seats, cards and chips down to fit. */
const DESIGN: Record<Shape, { w: number; h: number }> = { wide: { w: 760, h: 475 }, tall: { w: 420, h: 580 } };
const at = (p: Point) => ({ left: `${p.x}%`, top: `${p.y}%` });

/**
 * Picks the layout from the shape of the space the table gets (its parent), and how far to scale the
 * table's contents. Measured on the parent because the table's own box depends on the shape.
 */
function useTableShape(ref: RefObject<HTMLElement | null>) {
  const [fit, setFit] = useState<{ shape: Shape; scale: number }>({ shape: 'wide', scale: 1 });
  useLayoutEffect(() => {
    const area = ref.current?.parentElement;
    if (!area) return;
    const measure = () => {
      const { width, height } = area.getBoundingClientRect();
      if (!width || !height) return;
      const shape: Shape = height / width > 0.8 ? 'tall' : 'wide';
      // The table's box inside the area (as .table-wrap sizes it in styles.css), against the design size.
      const w = shape === 'wide' ? Math.min(width, height * 1.6) : Math.min(width, height * 0.9);
      const h = shape === 'wide' ? w / 1.6 : Math.min(height, width * 1.5);
      const fitted = Math.min(w / DESIGN[shape].w, h / DESIGN[shape].h);
      const scale = Math.round(Math.min(1, Math.max(0.55, fitted)) * 100) / 100;
      setFit((f) => (f.shape === shape && f.scale === scale ? f : { shape, scale }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(area);
    return () => ro.disconnect();
  }, [ref]);
  return fit;
}

const ACTION_TEXT: Record<ActionLogEntry['action'], (a: ActionLogEntry) => string> = {
  fold: () => 'Fold',
  check: () => 'Check',
  call: (a) => (a.street === 'preflop' && a.toBb === 1 ? 'Limp' : `Call ${a.streetBb ?? a.toBb}`),
  bet: (a) => `Bet ${a.streetBb}`,
  raise: (a) => `Raise ${a.streetBb ?? a.toBb}`,
  allin: () => 'All-in',
};

interface Props {
  hand: HandView;
  playback: PlaybackState;
  onSkip: () => void;
  /** A streak milestone: chips shower behind the seats. */
  celebration?: Celebration | null;
}

/**
 * What a seat's position means and how it plays, shown when its info bubble (position and stack) is
 * hovered, focused or tapped. It opens away from the table edge nearest the seat.
 */
function PositionTooltip({ position, slot }: { position: Position; slot: Point }) {
  const info = POSITION_INFO[position];
  const side = slot.x < 30 ? 'tip-right' : slot.x > 70 ? 'tip-left' : 'tip-center';
  const vertical = slot.y < 40 ? 'tip-below' : 'tip-above';
  return (
    <span role="tooltip" id={`pos-tip-${position}`} className={`tooltip ${side} ${vertical}`}>
      <strong>
        {position}: {info.name}
      </strong>
      <span>{info.turn}</span>
      <span className="muted">{info.why}</span>
    </span>
  );
}

export function Table({ hand, playback, onSkip, celebration }: Props) {
  const { animations, celebrations } = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  const { shape, scale } = useTableShape(ref);
  const layout = LAYOUTS[shape];
  const betSpot = (p: Point): Point => ({
    x: p.x + (layout.center.x - p.x) * 0.42,
    y: p.y + (layout.center.y - p.y) * 0.42,
  });
  const heroIdx = hand.seats.findIndex((s) => s.isHero);
  const n = hand.seats.length;
  const slotOf = (pos: Position) => layout.slots[(hand.seats.findIndex((s) => s.position === pos) - heroIdx + n) % n];

  const display = seatsAt(hand, playback.steps);
  const pot = potAt(display);
  const acting = actingAt(hand, playback);
  const result = hand.result;
  const winners = playback.awarded ? (result?.winners ?? []) : [];
  const showdown = new Map((playback.showdown ? (result?.showdown ?? []) : []).map((s) => [s.position, s]));
  // Hero folded to a bet or raise: that player's cards flip once the pot is pushed.
  const reveal = playback.awarded ? result?.foldReveal : null;
  const stack = hand.config.stackDepthBb;

  const chipTarget = (pos: Position): Point => {
    if (winners.length === 1) return betSpot(slotOf(winners[0]));
    if (playback.gathered) return layout.pot;
    return betSpot(slotOf(pos));
  };

  return (
    <div ref={ref} className={`table-wrap ${shape}`} style={{ ['--table-scale' as string]: scale }} onClick={onSkip} title="Click to skip animation">
      <div className="felt" />
      {celebration && animations && celebrations && <ChipRain key={celebration.at} celebration={celebration} />}

      <div className="pot-label" style={at(layout.potLabel)}>
        Pot <b>{pot}</b>bb
      </div>

      <div className="board" style={at(layout.board)}>
        {playback.board > 0 ? (
          (result?.board.length ? result.board : hand.board).slice(0, playback.board).map((c) => <PlayingCard key={c} card={c} size={shape === 'tall' ? 'sm' : 'md'} className="board-card" />)
        ) : (
          <span className="street">Preflop</span>
        )}
      </div>

      {hand.seats.map((seat) => {
        const d = display[seat.position];
        if (d.streetBet <= 0) return null;
        // Anchored at the seat's bet spot and slid to the pot or winner with `translate`, which the GPU animates.
        const home = betSpot(slotOf(seat.position));
        const to = chipTarget(seat.position);
        const slide = { translate: `calc(-50% + ${to.x - home.x}cqw) calc(-50% + ${to.y - home.y}cqh)` };
        return (
          <div key={`bet-${seat.position}`} className={`bet ${playback.gathered ? 'in-pot' : ''}`} style={{ ...at(home), ...slide }}>
            <ChipStack amount={d.streetBet} />
            {!playback.gathered && <span className="bet-amount">{d.streetBet}</span>}
          </div>
        );
      })}

      {hand.seats.map((seat, i) => {
        const d = display[seat.position];
        const sd = showdown.get(seat.position);
        const isWinner = winners.includes(seat.position);
        const won = isWinner && result ? result.potBb / result.winners.length : 0;
        const shown = sd ?? (reveal?.position === seat.position ? reveal : null);
        const cards = seat.isHero ? seat.cards : shown ? shown.cards : null;
        const dealOrder = (i - hand.seats.findIndex((s) => s.position === 'SB') + n) % n;
        return (
          <div
            key={seat.position}
            className={[
              'seat',
              seat.isHero && 'hero',
              d.folded && 'folded',
              isWinner && 'winner',
              acting === seat.position && 'acting',
            ]
              .filter(Boolean)
              .join(' ')}
            style={at(slotOf(seat.position))}
          >
            <div className="seat-cards">
              {[0, 1].map((k) => (
                <PlayingCard
                  key={cards ? cards[k] : `back-${k}`}
                  card={cards ? cards[k] : null}
                  size={seat.isHero ? 'md' : shape === 'tall' && !cards ? 'xs' : 'sm'}
                  className={`dealt ${shown && !seat.isHero ? 'flip' : ''}`}
                  style={{ ['--deal-delay' as string]: `${(k * n + dealOrder) * 32}ms` }}
                />
              ))}
            </div>
            <div className="seat-info pos-tip" tabIndex={0} aria-describedby={`pos-tip-${seat.position}`} onClick={(e) => e.stopPropagation()}>
              <span className="pos">
                {seat.position}
                {seat.position === 'BTN' && <span className="dealer">D</span>}
              </span>
              <span className="stack">{Math.round((stack - d.committed + won) * 100) / 100}bb</span>
              {d.lastAction && !sd && !playback.awarded && (
                <span key={d.lastAction.toBb + d.lastAction.action} className={`action-bubble act-${d.lastAction.action}`}>
                  {ACTION_TEXT[d.lastAction.action](d.lastAction)}
                </span>
              )}
              <PositionTooltip position={seat.position} slot={slotOf(seat.position)} />
            </div>
            {sd && <div className={`hand-name ${sd.isWinner ? 'win' : ''}`}>{sd.handName}</div>}
            {!sd && shown?.handName && <div className="hand-name">{shown.handName}</div>}
            {isWinner && <div className="win-tag">+{Math.round(won * 100) / 100}</div>}
          </div>
        );
      })}
    </div>
  );
}
