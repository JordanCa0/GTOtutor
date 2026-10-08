import type { ActionLogEntry, HandView, Position } from '@gtotutor/shared-types';
import { actingAt, potAt, seatsAt, type PlaybackState } from '../playback';
import { ChipStack } from './ChipStack';
import { PlayingCard } from './PlayingCard';

interface Point {
  x: number;
  y: number;
}

/** Seat anchors (% of the table box), clockwise from hero at the bottom; action moves clockwise. */
const SLOTS: Point[] = [
  { x: 50, y: 85 },
  { x: 10, y: 68 },
  { x: 10, y: 27 },
  { x: 50, y: 9 },
  { x: 90, y: 27 },
  { x: 90, y: 68 },
];
const TABLE_CENTER: Point = { x: 50, y: 48 };
const POT_SPOT: Point = { x: 50, y: 41 };
const betSpot = (p: Point): Point => ({
  x: p.x + (TABLE_CENTER.x - p.x) * 0.42,
  y: p.y + (TABLE_CENTER.y - p.y) * 0.42,
});
const at = (p: Point) => ({ left: `${p.x}%`, top: `${p.y}%` });

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
}

export function Table({ hand, playback, onSkip }: Props) {
  const heroIdx = hand.seats.findIndex((s) => s.isHero);
  const n = hand.seats.length;
  const slotOf = (pos: Position) => SLOTS[(hand.seats.findIndex((s) => s.position === pos) - heroIdx + n) % n];

  const display = seatsAt(hand, playback.steps);
  const pot = potAt(display);
  const acting = actingAt(hand, playback);
  const result = hand.result;
  const winners = playback.awarded ? (result?.winners ?? []) : [];
  const showdown = new Map((playback.showdown ? (result?.showdown ?? []) : []).map((s) => [s.position, s]));
  const stack = hand.config.stackDepthBb;

  const chipTarget = (pos: Position): Point => {
    if (winners.length === 1) return betSpot(slotOf(winners[0]));
    if (playback.gathered) return POT_SPOT;
    return betSpot(slotOf(pos));
  };

  return (
    <div className="table-wrap" onClick={onSkip} title="Click to skip animation">
      <div className="felt" />

      <div className="pot-label" style={at({ x: 50, y: 34 })}>
        Pot <b>{pot}</b>bb
      </div>

      <div className="board" style={at({ x: 50, y: 54 })}>
        {playback.board > 0 ? (
          (result?.board.length ? result.board : hand.board).slice(0, playback.board).map((c) => <PlayingCard key={c} card={c} className="board-card" />)
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
        const cards = seat.isHero ? seat.cards : sd ? sd.cards : null;
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
                  size={seat.isHero ? 'md' : 'sm'}
                  className={`dealt ${sd && !seat.isHero ? 'flip' : ''}`}
                  style={{ ['--deal-delay' as string]: `${(k * n + dealOrder) * 32}ms` }}
                />
              ))}
            </div>
            <div className="seat-info">
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
            </div>
            {sd && <div className={`hand-name ${sd.isWinner ? 'win' : ''}`}>{sd.handName}</div>}
            {isWinner && <div className="win-tag">+{Math.round(won * 100) / 100}</div>}
          </div>
        );
      })}
    </div>
  );
}
