import type { ActionLogEntry } from '@gtotutor/shared-types';
import { Fragment } from 'react';

const VERBS: Record<ActionLogEntry['action'], (a: ActionLogEntry) => string> = {
  fold: () => 'folds',
  check: () => 'checks',
  // Only the SB can call exactly 1bb preflop: that's a limp.
  call: (a) => (a.street === 'preflop' && a.toBb === 1 ? 'limps' : `calls ${a.streetBb ?? a.toBb}`),
  bet: (a) => `bets ${a.streetBb}`,
  raise: (a) => `raises ${a.streetBb ?? a.toBb}`,
  allin: (a) => `all-in ${a.toBb}`,
};
const describe = (a: ActionLogEntry) => VERBS[a.action](a);
const STREET_NAMES = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River' } as const;

export function ActionLog({ entries, board }: { entries: ActionLogEntry[]; board: string[] }) {
  return (
    <ol className="action-log" aria-label="Action history">
      <li className="muted">Blinds 0.5 / 1</li>
      {entries.map((a, i) => (
        <Fragment key={i}>
          {i > 0 && a.street !== entries[i - 1].street && (
            <li className="muted street-mark">
              {STREET_NAMES[a.street]} {a.street === 'flop' && board.slice(0, 3).join(' ')}
            </li>
          )}
          <li className={`${a.isHero ? 'hero' : ''} ${a.action === 'fold' ? 'fold' : ''}`}>
            <strong>{a.isHero ? 'You' : a.position}</strong> {describe(a)}
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
