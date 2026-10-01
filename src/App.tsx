import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { NexusLink, link } from './ble/link';
import { MouseSender } from './ble/mouse';
import { ChevronRight, GamepadIcon, KeyboardIcon, MediaIcon, MenuIcon, MonitorIcon, WindowIcon } from './icons';
import { NO_MODS, consumeMods, tapMod, type ModState } from './protocol/mods';
import { Ctrl, Page } from './protocol/packets';
import { DonglePanel } from './screens/DonglePanel';
import { KeyStrip, LiveInput } from './screens/KeyboardBar';
import { KeysPanel } from './screens/KeysPanel';
import { MediaPanel } from './screens/MediaPanel';
import { SettingsSheet } from './screens/Settings';
import { Trackpad } from './screens/Trackpad';
import { haptic, useSettings } from './settings';

type Panel = 'none' | 'keyboard' | 'media' | 'keys' | 'dongle';

export interface Ctx {
  mouse: MouseSender;
  mods: ModState;
  tapModifier: (bit: number) => void;
  /** Tap a key with whatever sticky modifiers are set, then clear the one-shots. */
  tapKey: (page: number, usage: number, extraMods?: number) => void;
  /** The sticky modifiers to wrap a click in, consuming the one-shots. */
  takeMods: () => number;
}

function useLink() {
  return useSyncExternalStore(
    (fn) => link.subscribe(fn),
    () => `${link.state}|${link.error}|${link.textPending}|${JSON.stringify(link.status)}`,
  );
}

/** Light or dark, following the phone unless the user picked one. */
function useTheme(choice: 'auto' | 'light' | 'dark') {
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'auto' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b0b1e' : '#e9e4ff');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [choice]);
}

/**
 * Size the app to the part of the screen the phone keyboard leaves, so the
 * toolbar rides on top of the keyboard. Android Chrome resizes the page
 * itself; iOS only reports it through visualViewport.
 */
function useVisibleViewport() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement.style;
    const fit = () => {
      root.setProperty('--app-h', `${vv.height}px`);
      root.setProperty('--app-top', `${vv.offsetTop}px`);
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }, []);
}

/** The last few characters typed, shown on the pad and gone after a pause. */
function useEcho(): [string, (added: string, erased: number) => void] {
  const [echo, setEcho] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const push = (added: string, erased: number) => {
    setEcho((e) => {
      if (added === '\n') return '';
      return (e.slice(0, Math.max(0, e.length - erased)) + added).slice(-24);
    });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setEcho(''), 2000);
  };
  return [echo, push];
}

export function App() {
  useLink();
  const settings = useSettings();
  useTheme(settings.theme);
  useVisibleViewport();
  const [panel, setPanel] = useState<Panel>('none');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mods, setMods] = useState<ModState>(NO_MODS);
  const [echo, pushEcho] = useEcho();
  const input = useRef<HTMLInputElement>(null);
  const mouse = useMemo(() => new MouseSender(link), []);

  // Reconnect on launch and whenever the app returns to the foreground; the
  // link drops in the background and NEXUS lets go of everything.
  useEffect(() => {
    void link.resume();
    const onVisible = () => {
      if (document.visibilityState === 'visible') link.wake();
      else mouse.releaseAll();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [mouse]);

  // The session's typing speed, sent again on every connect.
  useEffect(() => {
    if (link.state === 'connected') void link.control(Ctrl.typeDelay, settings.typeDelay).catch(() => undefined);
  }, [link.state, settings.typeDelay]);

  // Keep the screen on while connected, where the browser can.
  useEffect(() => {
    if (!settings.keepAwake || link.state !== 'connected' || !navigator.wakeLock) return;
    let lock: WakeLockSentinel | undefined;
    const take = () => {
      if (document.visibilityState === 'visible') {
        navigator.wakeLock.request('screen').then(
          (l) => (lock = l),
          () => undefined,
        );
      }
    };
    take();
    document.addEventListener('visibilitychange', take);
    return () => {
      document.removeEventListener('visibilitychange', take);
      void lock?.release();
    };
  }, [settings.keepAwake, link.state]);

  const ctx: Ctx = {
    mouse,
    mods,
    tapModifier: (bit) => {
      haptic();
      setMods((m) => tapMod(m, bit));
    },
    tapKey: (page, usage, extraMods = 0) => {
      haptic();
      const [held, next] = consumeMods(mods);
      setMods(next);
      void link.tap(page === Page.consumer ? 0 : held | extraMods, page, usage).catch(() => undefined);
    },
    takeMods: () => {
      const [held, next] = consumeMods(mods);
      setMods(next);
      return held;
    },
  };

  const toggle = (p: Panel) => {
    haptic();
    const next = panel === p ? 'none' : p;
    // Focus inside the tap itself: phones only raise the keyboard for a
    // focus that comes straight from a user gesture.
    if (next === 'keyboard') input.current?.focus();
    else input.current?.blur();
    setPanel(next);
  };

  const tool = (p: Panel | 'settings', label: string, icon: ReactNode) => (
    <button
      aria-label={label}
      aria-pressed={p === 'settings' ? settingsOpen : panel === p}
      className={(p === 'settings' ? settingsOpen : panel === p) ? 'on' : ''}
      onPointerDown={(e) => p === 'keyboard' && e.preventDefault() /* keep focus where it is */}
      onClick={() => {
        if (p === 'settings') {
          input.current?.blur();
          setSettingsOpen(true);
        } else toggle(p);
      }}
    >
      {icon}
    </button>
  );

  const typing = link.textPending > 0 || !!link.status?.typing;

  return (
    <div className="app">
      <div className="wallpaper" aria-hidden="true" />

      <header className="top">
        <DevicePill onOpen={() => setSettingsOpen(true)} />
        {link.error && <p className="toast error">{link.error}</p>}
      </header>

      <Trackpad ctx={ctx} echo={echo} buttons={panel === 'none' || panel === 'keyboard'} />

      {typing && (
        <div className="typing">
          <span>Typing{link.textPending ? ` · ${link.textPending} left` : '…'}</span>
          <button onClick={() => link.cancelText()}>Cancel</button>
        </div>
      )}

      {panel === 'media' && <MediaPanel ctx={ctx} onClose={() => setPanel('none')} />}
      {panel === 'keys' && <KeysPanel ctx={ctx} />}
      {panel === 'keyboard' && <KeyStrip ctx={ctx} />}
      {panel === 'dongle' && <DonglePanel />}

      <nav className="toolbar">
        {tool('settings', 'Settings', <MenuIcon />)}
        <span className="toolbar-divider" />
        {tool('media', 'Media controls', <MediaIcon />)}
        {tool('keys', 'Shortcuts and keys', <WindowIcon />)}
        {tool('dongle', 'NEXUS controls', <GamepadIcon />)}
        {tool('keyboard', 'Keyboard', <KeyboardIcon />)}
        <LiveInput
          ref={input}
          ctx={ctx}
          onEcho={pushEcho}
          onBlur={() => setPanel((p) => (p === 'keyboard' ? 'none' : p))}
        />
      </nav>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** Which NEXUS, in a glass pill at the top; tap to connect or for settings. */
function DevicePill({ onOpen }: { onOpen: () => void }) {
  const s = link.status;
  let label = 'Tap to connect';
  let tone = '';
  if (!NexusLink.supported()) {
    label = 'Open in Chrome, or Bluefy on iPhone';
    tone = 'warn';
  } else if (link.state === 'connecting') label = 'Connecting…';
  else if (link.state === 'reconnecting') label = 'Reconnecting…';
  else if (link.state === 'connected') {
    label = link.name || 'NEXUS';
    tone = s?.remoteOn ? 'ok' : 'warn';
  }

  const onClick = () => {
    haptic();
    if (link.state === 'idle' && NexusLink.supported()) void link.pick();
    else onOpen();
  };

  return (
    <button className={`device-pill ${tone}`} onClick={onClick}>
      <MonitorIcon />
      <span className="device-name">{label}</span>
      {link.state === 'connected' && !s?.remoteOn && <span className="device-note">Remote off</span>}
      {link.state === 'connected' && s?.capsLock && <span className="device-note">Caps</span>}
      <ChevronRight />
    </button>
  );
}
