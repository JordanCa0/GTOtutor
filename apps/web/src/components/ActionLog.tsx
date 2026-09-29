import type { ActionLogEntry } from '@gtotutor/shared-types';

const VERBS: Record<ActionLogEntry['action'], (a: ActionLogEntry) => string> = {
  fold: () => 'folds',
  check: () => 'checks',
  // Only the SB can call exactly 1bb: that's a limp.
  call: (a) => (a.toBb === 1 ? 'limps' : `calls ${a.toBb}`),
  raise: (a) => `raises ${a.toBb}`,
  allin: (a) => `all-in ${a.toBb}`,
};
const describe = (a: ActionLogEntry) => VERBS[a.action](a);

export function ActionLog({ entries }: { entries: ActionLogEntry[] }) {
  return (
    <ol className="action-log" aria-label="Action history">
      <li className="muted">Blinds 0.5 / 1</li>
      {entries.map((a, i) => (
        <li key={i} className={`${a.isHero ? 'hero' : ''} ${a.action === 'fold' ? 'fold' : ''}`}>
          <strong>{a.isHero ? 'You' : a.position}</strong> {describe(a)}
        </li>
      ))}
    </ol>
  );
}
