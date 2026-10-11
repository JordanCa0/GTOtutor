import { useRef, useState, type ReactNode } from 'react';
import { displayName, useAuth } from '../auth/auth';
import { supabase } from '../auth/supabase';
import { openAccountDialog, useDismiss } from './AccountMenu';
import { ClipboardListIcon, HelpIcon, MenuIcon, SlidersIcon, TrendingUpIcon } from './icons';
import { SettingsSwitches } from './SettingsMenu';

interface Props {
  onConfigure: () => void;
  onReview: () => void;
  onProgress: () => void;
  onHelp: () => void;
}

/** Below 1024px (phones and upright tablets): every header control in one menu. Wider screens show them as buttons. */
export function HeaderMenu({ onConfigure, onReview, onProgress, onHelp }: Props) {
  const { enabled, ready, session } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, setOpen);
  const pick = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const accounts = enabled && ready;

  return (
    <div className="header-menu" ref={ref}>
      <button className="icon-btn menu-btn" aria-label="Menu" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MenuIcon size={18} />
      </button>
      {open && (
        <div className="header-sheet" role="menu">
          {accounts && session && (
            <div className="sheet-id">
              <span className="account-avatar" aria-hidden>
                {displayName(session).slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{displayName(session)}</strong>
                <p className="muted small">{session.user.email}</p>
              </div>
            </div>
          )}
          <div className="sheet-group">
            <Item icon={<SlidersIcon size={16} />} onClick={pick(onConfigure)}>
              Configure game
            </Item>
            <Item icon={<HelpIcon size={16} />} onClick={pick(onHelp)}>
              How it works
            </Item>
          </div>
          <div className="sheet-group">
            <Item icon={<ClipboardListIcon size={16} />} onClick={pick(onReview)}>
              Session review
            </Item>
            {accounts && (
              <Item icon={<TrendingUpIcon size={16} />} onClick={pick(session ? onProgress : () => openAccountDialog('progress'))}>
                My progress
              </Item>
            )}
          </div>
          <div className="sheet-group">
            <p className="eyebrow">Settings</p>
            <SettingsSwitches />
          </div>
          {accounts && (
            <div className="sheet-group">
              {session ? (
                <>
                  <Item onClick={() => void supabase!.auth.signOut().then(() => setOpen(false))}>Sign out</Item>
                  <Item className="danger" onClick={pick(() => openAccountDialog('delete'))}>
                    Delete account…
                  </Item>
                </>
              ) : (
                <Item onClick={pick(() => openAccountDialog('auth'))}>Sign in to save progress</Item>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Item({ icon, className, onClick, children }: { icon?: ReactNode; className?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button role="menuitem" className={`menu-item${className ? ` ${className}` : ''}`} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}
