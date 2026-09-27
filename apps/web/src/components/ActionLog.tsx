import type { ActionLogEntry } from '@gtotutor/shared-types';

const describe = (a: ActionLogEntry) =>
  a.action === 'fold' ? 'folds' : a.action === 'call' ? `calls ${a.toBb}` : a.action === 'allin' ? `all-in ${a.toBb}` : `raises to ${a.toBb}`;

export function ActionLog({ entries }: { entries: ActionLogEntry[] }) {
  return (
    <ol className="action-log">
      <li className="muted">SB posts 0.5, BB posts 1</li>
      {entries.map((a, i) => (
        <li key={i} className={a.isHero ? 'hero' : ''}>
          <strong>{a.isHero ? `You (${a.position})` : a.position}</strong> {describe(a)}
        </li>
      ))}
    </ol>
  );
}
