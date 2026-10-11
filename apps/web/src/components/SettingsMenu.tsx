import { useRef, useState } from 'react';
import { updateSettings, useSettings } from '../settings';
import { playSound } from '../sound/soundEngine';
import { useDismiss } from './AccountMenu';

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

/** The settings switches, shared by the header's gear popover and the phone menu. */
export function SettingsSwitches() {
  const settings = useSettings();
  return (
    <>
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
      <Switch
        label="Celebrations"
        description="Chips shower down when a streak of good decisions hits 5, 10, 15…"
        checked={settings.celebrations}
        onChange={(celebrations) => updateSettings({ celebrations })}
      />
    </>
  );
}

export function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(open, ref, setOpen);

  return (
    <div className="settings-menu" ref={ref}>
      <button className="icon-btn settings-btn" aria-expanded={open} aria-haspopup="dialog" aria-label="Settings" title="Settings (sound and animations)" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden>
          <path
            d="M10 12.8a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6Zm6.4-1.9.1-.9-.1-.9 1.7-1.3-1.6-2.8-2 .8a6 6 0 0 0-1.6-.9L12.6 3H9.4l-.3 2.1a6 6 0 0 0-1.6.9l-2-.8L3.9 8l1.7 1.3-.1.7.1.9-1.7 1.3 1.6 2.8 2-.8c.5.4 1 .7 1.6.9l.3 1.9h3.2l.3-2.1c.6-.2 1.1-.5 1.6-.9l2 .8 1.6-2.8-1.7-1.1Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <div className="settings-pop" role="dialog" aria-label="Settings">
          <p className="eyebrow">Settings</p>
          <SettingsSwitches />
        </div>
      )}
    </div>
  );
}
