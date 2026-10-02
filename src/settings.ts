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

let tick: HTMLLabelElement | undefined;

/**
 * iOS has no Vibration API - navigator.vibrate is simply absent in WebKit,
 * Bluefy included. Since iOS 18 WebKit plays the system haptic when a switch
 * checkbox flips, and clicking its label flips it, so one hidden switch does
 * the job. Older iOS: nothing, as before.
 */
function iosTick() {
  if (!tick) {
    tick = document.createElement('label');
    tick.setAttribute('aria-hidden', 'true');
    tick.style.cssText = 'position:fixed;left:-100px;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const sw = document.createElement('input');
    sw.type = 'checkbox';
    sw.setAttribute('switch', '');
    sw.tabIndex = -1;
    tick.append(sw);
    document.body.append(tick);
  }
  // Keep the phone keyboard up: a tap on the key strip must not take focus.
  const focused = document.activeElement as HTMLElement | null;
  tick.click();
  if (focused && document.activeElement !== focused) focused.focus({ preventScroll: true });
}

export function haptic() {
  if (!current.haptics) return;
  if (navigator.vibrate) navigator.vibrate(VIBRATE_MS);
  else iosTick();
}
