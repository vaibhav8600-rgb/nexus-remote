import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { NexusLink, link } from './ble/link';
import { MouseSender } from './ble/mouse';
import { GearIcon, KeyboardIcon, MediaIcon, TrackpadIcon } from './icons';
import { NO_MODS, consumeMods, tapMod, type ModState } from './protocol/mods';
import { Ctrl, Page } from './protocol/packets';
import { Keyboard } from './screens/Keyboard';
import { Media } from './screens/Media';
import { SettingsScreen } from './screens/Settings';
import { Trackpad } from './screens/Trackpad';
import { haptic, useSettings } from './settings';

type Tab = 'pad' | 'keys' | 'media' | 'settings';

const TABS: { id: Tab; title: string; icon: ReactNode }[] = [
  { id: 'pad', title: 'Trackpad', icon: <TrackpadIcon /> },
  { id: 'keys', title: 'Keyboard', icon: <KeyboardIcon /> },
  { id: 'media', title: 'Media', icon: <MediaIcon /> },
  { id: 'settings', title: 'Settings', icon: <GearIcon /> },
];

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
    () => `${link.state}|${link.error}|${link.textPending}|${link.textQueued}|${JSON.stringify(link.status)}`,
  );
}

/** Light or dark, following the phone unless the user picked one. */
function useTheme(choice: 'auto' | 'light' | 'dark') {
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = choice === 'dark' || (choice === 'auto' && media.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      // The status bar and the browser chrome follow the page.
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#000000' : '#f2f2f7');
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [choice]);
}

export function App() {
  useLink();
  const settings = useSettings();
  useTheme(settings.theme);
  const [tab, setTab] = useState<Tab>('pad');
  const [mods, setMods] = useState<ModState>(NO_MODS);
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
        navigator.wakeLock.request('screen').then((l) => (lock = l), () => undefined);
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

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="app">
      <NavBar title={current.title} />
      <main className={tab === 'pad' ? 'content fill' : 'content'}>
        {tab === 'pad' && <Trackpad ctx={ctx} />}
        {tab === 'keys' && <Keyboard ctx={ctx} />}
        {tab === 'media' && <Media ctx={ctx} />}
        {tab === 'settings' && <SettingsScreen />}
      </main>
      <nav className="tab-bar" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === tab}
            className={t.id === tab ? 'selected' : ''}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-icon">{t.icon}</span>
            <span className="tab-label">{t.title}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function NavBar({ title }: { title: string }) {
  const s = link.status;
  const connected = link.state === 'connected';

  let status = 'Not Connected';
  let tone = '';
  if (!NexusLink.supported()) {
    status = 'Bluetooth unavailable in this browser';
    tone = 'warn';
  } else if (link.state === 'connecting') status = 'Connecting…';
  else if (link.state === 'reconnecting') status = 'Reconnecting…';
  else if (connected && !s?.remoteOn) {
    status = 'Remote input is off on NEXUS';
    tone = 'warn';
  } else if (connected) {
    status = link.name || 'Connected';
    tone = 'ok';
  }

  return (
    <header className="nav-bar">
      <div className="nav-top">
        <span className={`status ${tone}`}>
          <span className="status-dot" />
          {status}
          {connected && s?.capsLock && <span className="badge">Caps Lock</span>}
        </span>
        {NexusLink.supported() &&
          (link.state === 'idle' ? (
            <button className="nav-button" onClick={() => void link.pick()}>
              Connect
            </button>
          ) : (
            <button className="nav-button" onClick={() => link.disconnect()}>
              Disconnect
            </button>
          ))}
      </div>
      <h1 className="large-title">{title}</h1>
      {!NexusLink.supported() && (
        <p className="banner">Use Chrome on Android, or the Bluefy browser on iPhone - Safari has no Web Bluetooth.</p>
      )}
      {link.error && <p className="banner error">{link.error}</p>}
    </header>
  );
}
