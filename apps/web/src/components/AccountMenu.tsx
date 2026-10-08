import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api/client';
import { dismissAuthError, displayName, signInWithGoogle, useAuth } from '../auth/auth';
import { supabase } from '../auth/supabase';
import { XIcon } from './icons';
import { Backdrop, Presence } from './Presence';

/** Header control: "Sign in" for guests, the account menu when signed in. Hidden when sign-in isn't configured. */
export function AccountMenu() {
  const { enabled, ready, session, error } = useAuth();
  const [dialog, setDialog] = useState<'auth' | 'delete' | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => menuRef.current && !menuRef.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  if (!enabled) return null;
  const failure = error &&
    createPortal(
      <div className="auth-toast" role="alert">
        <div>
          <strong>Sign-in failed</strong>
          <p>{error}</p>
        </div>
        <button className="ghost" onClick={dismissAuthError}>
          Dismiss
        </button>
      </div>,
      document.body,
    );
  if (!ready) return failure || null;

  return (
    <>
      {session ? (
        <div className="account" ref={menuRef}>
          <button className="ghost account-btn" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
            <span className="account-avatar" aria-hidden>
              {displayName(session).slice(0, 1).toUpperCase()}
            </span>
            {displayName(session)}
          </button>
          {open && (
            <div className="account-menu" role="menu">
              <p className="muted small">Signed in as {session.user.email}</p>
              <button role="menuitem" className="ghost" onClick={() => void supabase!.auth.signOut().then(() => setOpen(false))}>
                Sign out
              </button>
              <button role="menuitem" className="ghost danger" onClick={() => (setOpen(false), setDialog('delete'))}>
                Delete account…
              </button>
            </div>
          )}
        </div>
      ) : (
        <button className="ghost" onClick={() => setDialog('auth')}>
          Sign in
        </button>
      )}
      <Presence show={dialog === 'auth' && !session}>
        <AuthDialog onClose={() => setDialog(null)} />
      </Presence>
      <Presence show={dialog === 'delete' && !!session}>
        <DeleteAccountDialog onClose={() => setDialog(null)} />
      </Presence>
      {failure}
    </>
  );
}

function Modal({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose?: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <Backdrop onClose={onClose}>
      <div className="auth-card" role="dialog" aria-modal aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="auth-head">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
          </div>
          {onClose && (
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <XIcon />
            </button>
          )}
        </div>
        {children}
      </div>
    </Backdrop>
  );
}

/** Sign-in is Google only. */
function AuthDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    setBusy(true);
    setError(null);
    const { error } = await signInWithGoogle();
    // On success the browser leaves for Google, so only a failure lands here.
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  };

  return (
    <Modal eyebrow="Account" title="Sign in" onClose={onClose}>
      <p className="muted small">Your hands, decisions, and coach chats are saved to your account. Anything you played as a guest this session comes with you.</p>
      <button className="google-btn" disabled={busy} onClick={() => void google()}>
        <GoogleMark /> Continue with Google
      </button>
      {error && <p className="error small">{error}</p>}
    </Modal>
  );
}

function DeleteAccountDialog({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteAccount();
      // The account no longer exists on the server, so only clear this browser's session.
      await supabase!.auth.signOut({ scope: 'local' });
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal eyebrow="Account" title="Delete your account?" onClose={busy ? undefined : onClose}>
      <p>This permanently deletes your account and everything saved with it: hands, decisions, stars, notes, and coach chats. It can't be undone.</p>
      {error && <p className="error small">{error}</p>}
      <div className="auth-actions">
        <button className="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button className="primary danger" onClick={() => void remove()} disabled={busy}>
          {busy ? 'Deleting…' : 'Delete account'}
        </button>
      </div>
    </Modal>
  );
}

export function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.9 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
