import {
  STAKES_PRESETS,
  TRACKED_GAME_MODES,
  TRACKER_LIMITS,
  type TrackedGameMode,
  type TrackedGameType,
  type TrackedSession,
  type TrackedSessionInput,
} from '@gtotutor/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../auth/auth';
import { Backdrop, Presence } from './Presence';
import JellyRadio from './reactbits/JellyRadio';
import { JELLY_THEME } from './SetupScreen';
import { Skeleton, SkeletonGroup, useSkeleton } from './Skeleton';

type Filter = 'all' | TrackedGameType;
/** The form: a new session, or the one being edited. */
type Editing = { kind: 'new' } | { kind: 'edit'; session: TrackedSession };

const dollars = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Whole amounts without cents, anything else with both digits: "$300", "$120.50". */
const money = (n: number) => (Math.abs(Math.round(n * 100) % 100) === 0 ? dollars : cents).format(n);
/** "+$300", "−$120.50", "$0". */
const signed = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `−${money(-n)}` : money(0));
const resultClass = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const hoursText = (h: number) => `${Number(h.toFixed(2))}h`;
const GAME_TYPE_LABEL: Record<TrackedGameType, string> = { cash: 'Cash', tournament: 'Tournament' };
const GAME_MODE_LABEL = Object.fromEntries(TRACKED_GAME_MODES.map((m) => [m.id, m.label])) as Record<TrackedGameMode, string>;

/** A blind as written on a stakes sign: "$1", "$0.25", "$0.10". */
const blindText = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
/** "$1/$3". */
const stakesText = (sb: number, bb: number) => `${blindText(sb)}/${blindText(bb)}`;
/** The stakes dropdown's value: a preset as "sb/bb", "custom", or "" for not set. */
const stakesKey = (sb: number, bb: number) => `${sb}/${bb}`;
const STAKES_OPTIONS = STAKES_PRESETS.map(([sb, bb]) => ({ value: stakesKey(sb, bb), label: stakesText(sb, bb) }));

/** Today in the player's time zone, as YYYY-MM-DD. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Sat, Nov 1", with the year only when it isn't this one. Parsed as a local date so it never shifts a day. */
function dateText(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(y !== new Date().getFullYear() && { year: 'numeric' }) });
}

/** The poker tracker: sessions played away from GTOtutor (live or online), logged by hand, with totals. */
export function TrackerPage({ onClose }: { onClose: () => void }) {
  const { session } = useAuth();
  const [editing, setEditing] = useState<Editing | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !editing && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, editing]);

  return (
    <div className="profile-page" role="dialog" aria-modal="true" aria-label="Poker tracker">
      <div className="profile-inner">
        <header className="profile-head">
          <div>
            <h1>Poker tracker</h1>
            <p className="muted small">Log the sessions you play at the casino, at home or online, and see how they add up.</p>
          </div>
          <div className="tracker-head-actions">
            {session && (
              <button className="primary" onClick={() => setEditing({ kind: 'new' })}>
                Log a session
              </button>
            )}
            <button className="ghost" onClick={onClose}>
              Back to the table
            </button>
          </div>
        </header>
        {session ? (
          <TrackerBody onEdit={(s) => setEditing({ kind: 'edit', session: s })} onNew={() => setEditing({ kind: 'new' })} />
        ) : (
          <p className="muted">Sign in to log your sessions: the date, where you played, hours, what you won or lost, and notes.</p>
        )}
      </div>
      <Presence show={!!editing}>{editing && <SessionForm editing={editing} onClose={() => setEditing(null)} />}</Presence>
    </div>
  );
}

function TrackerBody({ onEdit, onNew }: { onEdit: (s: TrackedSession) => void; onNew: () => void }) {
  const tracker = useQuery({ queryKey: ['tracker'], queryFn: api.tracker });
  const [filter, setFilter] = useState<Filter>('all');
  const skeleton = useSkeleton(tracker.isPending);

  if (skeleton.active || tracker.isPending) return <TrackerSkeleton visible={skeleton.visible} />;
  if (tracker.error) return <p className="error">{tracker.error.message}</p>;
  const all = tracker.data.sessions;
  if (!all.length) {
    return (
      <div className="tracker-empty">
        <p className="muted">No sessions yet. Log your first one and your results, hours and hourly rate show up here.</p>
        <button className="ghost" onClick={onNew}>
          Log a session
        </button>
      </div>
    );
  }

  const shown = filter === 'all' ? all : all.filter((s) => s.gameType === filter);
  const net = shown.reduce((sum, s) => sum + s.result, 0);
  const hours = shown.reduce((sum, s) => sum + s.hours, 0);
  const winning = shown.filter((s) => s.result > 0).length;
  const both = all.some((s) => s.gameType === 'cash') && all.some((s) => s.gameType === 'tournament');

  return (
    <>
      {both && (
        <JellyRadio
          {...JELLY_THEME}
          ariaLabel="Show"
          items={[
            { value: 'all', label: 'All games' },
            { value: 'cash', label: 'Cash' },
            { value: 'tournament', label: 'Tournaments' },
          ]}
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
        />
      )}
      <section className="profile-stats" aria-label="Totals">
        <div className="profile-stat">
          <p className="profile-stat-label">Net result</p>
          <p className={`profile-stat-value ${resultClass(net)}`}>{signed(net)}</p>
          <p className="muted small">
            {shown.length} session{shown.length === 1 ? '' : 's'}, {winning} winning.
          </p>
        </div>
        <div className="profile-stat">
          <p className="profile-stat-label">Per hour</p>
          <p className={`profile-stat-value ${resultClass(net)}`}>{hours > 0 ? signed(net / hours) : '–'}</p>
          <p className="muted small">Net result over hours played. It takes a few hundred hours to settle.</p>
        </div>
        <div className="profile-stat">
          <p className="profile-stat-label">Hours played</p>
          <p className="profile-stat-value">{Number(hours.toFixed(1))}</p>
          <p className="muted small">About {hoursText(shown.length ? hours / shown.length : 0)} a session.</p>
        </div>
      </section>

      <section className="profile-section">
        <h2>
          Sessions <span className="profile-count">{shown.length}</span>
        </h2>
        <ul className="starred-list">
          {shown.map((s) => (
            <li key={s.id}>
              <button className="starred-item tracker-item" onClick={() => onEdit(s)} aria-label={`Edit session on ${dateText(s.date)} at ${s.location}`}>
                <span className="tracker-date muted small">{dateText(s.date)}</span>
                <span className="starred-text">
                  <strong>{s.location}</strong>
                  <span className="muted small">
                    {[
                      GAME_TYPE_LABEL[s.gameType],
                      s.gameMode && GAME_MODE_LABEL[s.gameMode],
                      s.smallBlind !== null && s.bigBlind !== null && stakesText(s.smallBlind, s.bigBlind),
                      hoursText(s.hours),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {s.notes && <span className="starred-note">{s.notes}</span>}
                </span>
                <span className="tracker-money">
                  <span className={`tracker-result ${resultClass(s.result)}`}>{signed(s.result)}</span>
                  <span className="muted small">
                    In {money(s.buyIn)} · Out {money(s.cashOut)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!shown.length && <p className="muted small">No {filter === 'cash' ? 'cash' : 'tournament'} sessions yet.</p>}
      </section>
    </>
  );
}

function TrackerSkeleton({ visible }: { visible: boolean }) {
  return (
    <SkeletonGroup visible={visible} label="Loading your sessions" className="profile-skeleton">
      <div className="profile-stats">
        {[0, 1, 2].map((i) => (
          <div key={i} className="profile-stat">
            <Skeleton width="40%" />
            <Skeleton width="55%" height="2.2rem" />
            <Skeleton width="85%" />
          </div>
        ))}
      </div>
      <Skeleton width="7rem" height="1.4rem" />
      <div className="skeleton-stack">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} kind="block" height="3.25rem" />
        ))}
      </div>
    </SkeletonGroup>
  );
}

/** Where the stakes dropdown starts: the session's preset, "custom" for other blinds, or "" for none. */
function initialStakes(s: TrackedSession | null): string {
  if (!s || s.smallBlind === null || s.bigBlind === null) return '';
  const key = stakesKey(s.smallBlind, s.bigBlind);
  return STAKES_OPTIONS.some((o) => o.value === key) ? key : 'custom';
}

/** Log a new session or edit (or delete) one. Money is entered as in and out; the result is worked out from them. */
function SessionForm({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const queryClient = useQueryClient();
  const start = editing.kind === 'edit' ? editing.session : null;
  const [date, setDate] = useState(start?.date ?? today());
  const [location, setLocation] = useState(start?.location ?? '');
  const [gameType, setGameType] = useState<TrackedGameType>(start?.gameType ?? 'cash');
  const [gameMode, setGameMode] = useState<TrackedGameMode | ''>(start?.gameMode ?? '');
  const [stakes, setStakes] = useState(() => initialStakes(start));
  const [customSb, setCustomSb] = useState(start?.smallBlind != null ? String(start.smallBlind) : '');
  const [customBb, setCustomBb] = useState(start?.bigBlind != null ? String(start.bigBlind) : '');
  const [hours, setHours] = useState(start ? String(start.hours) : '');
  const [buyIn, setBuyIn] = useState(start ? String(start.buyIn) : '');
  const [cashOut, setCashOut] = useState(start ? String(start.cashOut) : '');
  const [notes, setNotes] = useState(start?.notes ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Earlier answers come back as suggestions, so the same card room is spelled the same way each time.
  const previous = queryClient.getQueryData<{ sessions: TrackedSession[] }>(['tracker'])?.sessions ?? [];
  const locations = useMemo(() => [...new Set(previous.map((s) => s.location))], [previous]);
  const cash = gameType === 'cash';

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['tracker'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: (input: TrackedSessionInput) => (start ? api.updateTracked(start.id, input) : api.addTracked(input)),
    onSuccess: done,
  });
  const remove = useMutation({ mutationFn: () => api.deleteTracked(start!.id), onSuccess: done });
  const busy = save.isPending || remove.isPending;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const hoursN = Number(hours);
  const validMoney = (v: string) => v !== '' && Number(v) >= 0 && Number(v) <= TRACKER_LIMITS.maxResult;
  // The blinds sent: a preset's, the custom pair, or none (also for tournaments).
  const [sb, bb] =
    !cash || stakes === '' ? [null, null]
    : stakes === 'custom' ? [customSb === '' ? NaN : Number(customSb), customBb === '' ? NaN : Number(customBb)]
    : stakes.split('/').map(Number);
  const blindsOk = sb === null || (sb > 0 && bb !== null && bb >= sb && bb <= TRACKER_LIMITS.maxBlind);
  const net = validMoney(buyIn) && validMoney(cashOut) ? (Math.round(Number(cashOut) * 100) - Math.round(Number(buyIn) * 100)) / 100 : null;
  const invalid =
    !date ? 'Pick the date you played.'
    : date > today() ? "That date hasn't happened yet."
    : !location.trim() ? 'Add where you played.'
    : !blindsOk ? 'Enter both blinds, with the small blind no bigger than the big blind.'
    : !(hoursN > 0 && hoursN <= TRACKER_LIMITS.maxHours) ? `Hours should be more than 0 and at most ${TRACKER_LIMITS.maxHours}.`
    : !validMoney(buyIn) ? (cash ? 'Add your buy-in, including rebuys.' : 'Add what you paid in buy-ins.')
    : !validMoney(cashOut) ? (cash ? 'Add what you cashed out (0 if you went bust).' : 'Add what you cashed (0 if you didn’t).')
    : null;
  const [tried, setTried] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (invalid || busy) return;
    save.mutate({
      date,
      location: location.trim(),
      hours: hoursN,
      buyIn: Number(buyIn),
      cashOut: Number(cashOut),
      gameType,
      gameMode: gameMode || null,
      smallBlind: sb,
      bigBlind: bb,
      notes: notes.trim() || null,
    });
  };

  return (
    <Backdrop onClose={busy ? undefined : onClose}>
      <form className="modal tracker-form" role="dialog" aria-modal="true" aria-label={start ? 'Edit session' : 'Log a session'} onClick={(e) => e.stopPropagation()} onSubmit={submit} noValidate>
        <div className="modal-head">
          <h2>{start ? 'Edit session' : 'Log a session'}</h2>
          <button type="button" className="link" onClick={onClose} disabled={busy}>
            Close
          </button>
        </div>

        <div className="tracker-fields">
          <label className="tracker-field">
            <span className="eyebrow">Date</span>
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="tracker-field">
            <span className="eyebrow">Location</span>
            <input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={TRACKER_LIMITS.textMaxChars} placeholder="Casino, home game, site…" list="tracker-locations" required autoFocus={!start} />
            <datalist id="tracker-locations">
              {locations.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </label>

          <div className="tracker-field tracker-wide">
            <span className="eyebrow">
              Game type
            </span>
            <JellyRadio
              {...JELLY_THEME}
              ariaLabel="Game type"
              items={[
                { value: 'cash', label: 'Cash' },
                { value: 'tournament', label: 'Tournament' },
              ]}
              value={gameType}
              onChange={(v) => setGameType(v as TrackedGameType)}
            />
          </div>
          <label className={`tracker-field${cash ? '' : ' tracker-wide'}`}>
            <span className="eyebrow">Game</span>
            <select value={gameMode} onChange={(e) => setGameMode(e.target.value as TrackedGameMode | '')}>
              <option value="">Not set</option>
              {TRACKED_GAME_MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {cash && (
            <label className="tracker-field">
              <span className="eyebrow">Stakes</span>
              <select value={stakes} onChange={(e) => setStakes(e.target.value)}>
                <option value="">Not set</option>
                {STAKES_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </label>
          )}
          {cash && stakes === 'custom' && (
            <div className="tracker-field tracker-wide">
              <span className="eyebrow">Custom stakes</span>
              <div className="tracker-blinds">
                <span aria-hidden>$</span>
                <input type="number" inputMode="decimal" min="0.01" step="0.01" value={customSb} onChange={(e) => setCustomSb(e.target.value)} placeholder="Small blind" aria-label="Small blind" autoFocus />
                <span aria-hidden>/ $</span>
                <input type="number" inputMode="decimal" min="0.01" step="0.01" value={customBb} onChange={(e) => setCustomBb(e.target.value)} placeholder="Big blind" aria-label="Big blind" />
              </div>
            </div>
          )}

          <label className="tracker-field">
            <span className="eyebrow">{cash ? 'Buy-in (with rebuys)' : 'Buy-ins (with re-entries)'}</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={buyIn} onChange={(e) => setBuyIn(e.target.value)} placeholder="0" required />
          </label>
          <label className="tracker-field">
            <span className="eyebrow">{cash ? 'Cash-out' : 'Cashed'}</span>
            <input type="number" inputMode="decimal" min="0" step="0.01" value={cashOut} onChange={(e) => setCashOut(e.target.value)} placeholder="0" required />
          </label>

          <label className="tracker-field">
            <span className="eyebrow">Hours played</span>
            <input type="number" inputMode="decimal" min="0.25" max={TRACKER_LIMITS.maxHours} step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="4.5" required />
          </label>
          <div className="tracker-field" aria-live="polite">
            <span className="eyebrow">Result</span>
            <p className={`tracker-net ${net === null ? 'muted' : resultClass(net)}`}>{net === null ? '–' : signed(net)}</p>
          </div>

          <label className="tracker-field tracker-wide">
            <span className="eyebrow">Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={TRACKER_LIMITS.notesMaxChars} rows={3} placeholder="Big hands, table dynamics, how you felt…" />
          </label>
        </div>

        {tried && invalid && <p className="error small">{invalid}</p>}
        {(save.error || remove.error) && <p className="error small">{(save.error ?? remove.error)!.message}</p>}

        <div className="modal-foot tracker-foot">
          {start &&
            (confirmDelete ? (
              <span className="tracker-confirm">
                <span className="small">Delete this session?</span>
                <button type="button" className="primary danger" disabled={busy} onClick={() => remove.mutate()}>
                  Delete
                </button>
                <button type="button" className="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="ghost danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
                Delete session
              </button>
            ))}
          <span className="spacer" />
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {save.isPending ? 'Saving…' : start ? 'Save changes' : 'Log session'}
          </button>
        </div>
      </form>
    </Backdrop>
  );
}
