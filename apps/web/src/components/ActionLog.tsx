import type { ActionLogEntry } from '@gtotutor/shared-types';

const describe = (a: ActionLogEntry) =>
  a.action === 'fold' ? 'folds' : a.action === 'call' ? `calls ${a.toBb}` : a.action === 'allin' ? `all-in ${a.toBb}` : `raises ${a.toBb}`;

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
