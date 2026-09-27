import type { HandView } from '@gtotutor/shared-types';
import { PlayingCard } from './PlayingCard';

/** Seat slots clockwise from hero at the bottom; action moves clockwise. */
const SLOTS = [
  { left: '50%', top: '88%' },
  { left: '10%', top: '66%' },
  { left: '10%', top: '22%' },
  { left: '50%', top: '4%' },
  { left: '90%', top: '22%' },
  { left: '90%', top: '66%' },
];

export function Table({ hand }: { hand: HandView }) {
  const heroIdx = hand.seats.findIndex((s) => s.isHero);
  const n = hand.seats.length;
  const toAct = hand.status === 'awaiting_hero';

  return (
    <div className="table-wrap">
      <div className="felt">
        <div className="center">
          <div className="pot">Pot {hand.potBb}bb</div>
          <div className="board">
            {hand.result?.board.length ? hand.result.board.map((c) => <PlayingCard key={c} card={c} />) : <span className="muted small">Preflop</span>}
          </div>
        </div>
      </div>
      {hand.seats.map((seat, i) => {
        const slot = SLOTS[(i - heroIdx + n) % n];
        const winner = hand.result?.winners.includes(seat.position);
        return (
          <div
            key={seat.position}
            className={`seat ${seat.isHero ? 'hero' : ''} ${seat.folded ? 'folded' : ''} ${winner ? 'winner' : ''} ${seat.isHero && toAct ? 'acting' : ''}`}
            style={slot}
          >
            <div className="seat-cards">
              {seat.folded && !seat.isHero ? null : (seat.cards ?? [null, null]).map((c, k) => <PlayingCard key={k} card={c} size="sm" />)}
            </div>
            <div className="seat-info">
              <strong>
                {seat.position}
                {seat.position === 'BTN' && <span className="dealer">D</span>}
              </strong>
              <span>{seat.stackBb}bb</span>
            </div>
            {seat.committedBb > 0 && <div className="bet">{seat.committedBb}</div>}
            {seat.folded && <div className="tag">Fold</div>}
            {seat.allIn && <div className="tag allin">All-in</div>}
          </div>
        );
      })}
    </div>
  );
}
