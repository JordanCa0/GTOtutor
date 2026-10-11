import { useSyncExternalStore } from 'react';
import { isSoundEnabled, setSoundEnabled } from './sound/soundEngine';

export interface Settings {
  sound: boolean;
  animations: boolean;
  /** Chip showers at streak milestones. */
  celebrations: boolean;
}

const ANIMATIONS_KEY = 'gtotutor.animations';
const CELEBRATIONS_KEY = 'gtotutor.celebrations';

function readOn(key: string): boolean {
  try {
    return localStorage.getItem(key) !== 'off';
  } catch {
    return true;
  }
}

function writeOn(key: string, on: boolean): void {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // storage blocked; the setting lasts for this tab only
  }
}

let current: Settings = { sound: isSoundEnabled(), animations: readOn(ANIMATIONS_KEY), celebrations: readOn(CELEBRATIONS_KEY) };
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  if (patch.sound !== undefined) setSoundEnabled(patch.sound);
  if (patch.animations !== undefined) writeOn(ANIMATIONS_KEY, patch.animations);
  if (patch.celebrations !== undefined) writeOn(CELEBRATIONS_KEY, patch.celebrations);
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
