// Settings live on the phone, in localStorage. Nothing here is sent anywhere
// except the typing delay, which the dongle forgets on every reconnect.
import { useSyncExternalStore } from 'react';
import type { HostOs } from './protocol/hid';

export interface Settings {
  speed: number; // pointer gain, 0.5-4
  accel: number; // 0 = linear, 2 = strong
  scroll: number; // notches per 24px of finger travel
  natural: boolean;
  tapToClick: boolean;
  longPressRight: boolean;
  typeDelay: number; // ms, 2-50
  os: HostOs;
  haptics: boolean;
  keepAwake: boolean;
  theme: 'auto' | 'light' | 'dark';
  snippets: string[]; // text typed with one tap, from the Keys panel
}

const DEFAULTS: Settings = {
  speed: 1.6,
  accel: 1,
  scroll: 1,
  natural: true,
  tapToClick: true,
  longPressRight: false,
  typeDelay: 8,
  os: 'windows',
  haptics: true,
  keepAwake: true,
  theme: 'auto',
  snippets: [],
};

const KEY = 'nexus.settings';
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

let current = load();

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* private mode: settings last for the session */
  }
  for (const l of listeners) l();
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

/** Long enough to feel on Android's weaker motors; 8 ms often was not. */
const VIBRATE_MS = 15;

/**
 * iPhone and iPad, Safari or not - every iOS browser is WebKit. Checked by
 * platform rather than by navigator.vibrate, which a wrapper app like Bluefy
 * can define as a stub that does nothing.
 */
export const IOS =
  typeof navigator !== 'undefined' &&
  (/iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/** How this browser does haptics, for Settings to show. */
export const hapticMethod: 'vibrate' | 'ios-switch' | 'none' = IOS
  ? 'ios-switch'
  : typeof navigator !== 'undefined' && 'vibrate' in navigator
    ? 'vibrate'
    : 'none';

/** Android's haptic. On iOS the tap itself does it, through <Tick> (ui.tsx). */
export function haptic(force = false) {
  if ((current.haptics || force) && hapticMethod === 'vibrate') navigator.vibrate(VIBRATE_MS);
}

export function hapticsOn(): boolean {
  return current.haptics;
}
