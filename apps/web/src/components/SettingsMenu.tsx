import { useEffect, useRef, useState } from 'react';
import { updateSettings, useSettings } from '../settings';
import { playSound } from '../sound/soundEngine';

function Switch({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="setting">
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch" aria-hidden />
    </label>
  );
}

export function SettingsMenu() {
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="settings-menu" ref={ref}>
      <button className="ghost settings-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
          <path
            d="M10 12.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Zm6.4-1.9.1-.9-.1-.9 1.7-1.3-1.6-2.8-2 .8a6 6 0 0 0-1.6-.9L12.6 3H9.4l-.3 2.1a6 6 0 0 0-1.6.9l-2-.8L3.9 8l1.7 1.3-.1.7.1.9-1.7 1.3 1.6 2.8 2-.8c.5.4 1 .7 1.6.9l.3 1.9h3.2l.3-2.1c.6-.2 1.1-.5 1.6-.9l2 .8 1.6-2.8-1.7-1.1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        Settings
      </button>
      {open && (
        <div className="settings-pop" role="dialog" aria-label="Settings">
          <p className="eyebrow">Settings</p>
          <Switch
            label="Sound effects"
            description="Cards, chips, and the chime after each decision."
            checked={settings.sound}
            onChange={(sound) => {
              updateSettings({ sound });
              if (sound) playSound('chip');
            }}
          />
          <Switch
            label="Animations"
            description="Off: deals, bets, and the runout appear instantly."
            checked={settings.animations}
            onChange={(animations) => updateSettings({ animations })}
          />
        </div>
      )}
    </div>
  );
}
