import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Ctx } from '../App';
import { ChevronLeft, ChevronRight } from '../icons';
import { KEY, letter } from '../protocol/hid';
import { Mod, Page } from '../protocol/packets';
import { IOS, haptic, useSettings } from '../settings';
import { Tick } from '../ui';

/** Pixels per degree the phone turns, before Tracking Speed. */
const AIR_GAIN = 14;
/** Longest gap between motion samples that still counts as one movement. */
const AIR_MAX_DT = 0.05;

type MotionPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

/**
 * Point with the phone held upright, its back toward the screen: turning it
 * left and right spins it about its own y axis (up the screen), tilting it up
 * and down about its x axis (across the screen). The gyroscope's rotation
 * rate, times the time since the last sample, is the angle moved - nothing
 * drifts while it is still.
 *
 * Which field carries which axis depends on the engine. The spec, and Chrome,
 * put the z rate in alpha, x in beta and y in gamma; WebKit - every iOS
 * browser - reports x in alpha, y in beta and z in gamma. Taking the wrong
 * pair turned "point up" into a move to the left, as seen on an iPhone.
 */
function rates(r: DeviceMotionEventRotationRate): { x: number; y: number } {
  return IOS ? { x: r.alpha ?? 0, y: r.beta ?? 0 } : { x: r.beta ?? 0, y: r.gamma ?? 0 };
}

function useAirPointer(ctx: Ctx, speed: number) {
  const [on, setOn] = useState(false);
  const last = useRef(0);

  useEffect(() => {
    if (!on) return;
    last.current = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const r = e.rotationRate;
      if (!r) return;
      const dt = last.current ? Math.min((e.timeStamp - last.current) / 1000, AIR_MAX_DT) : 0;
      last.current = e.timeStamp;
      const gain = AIR_GAIN * speed * dt;
      const { x, y } = rates(r);
      // Turning right is a negative turn about y and should move right;
      // tilting up is a positive turn about x and should move up (-y).
      ctx.mouse.move(-y * gain, -x * gain);
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [on, speed, ctx.mouse]);

  const toggle = async (): Promise<string> => {
    if (on) {
      setOn(false);
      return '';
    }
    if (typeof DeviceMotionEvent === 'undefined') return 'This phone has no motion sensor the browser can read.';
    // iOS asks once, and only from a tap.
    const ask = (DeviceMotionEvent as unknown as MotionPermission).requestPermission;
    if (ask && (await ask().catch(() => 'denied')) !== 'granted') return 'Motion access was not allowed.';
    setOn(true);
    return '';
  };

  return { on, toggle };
}

/** Elapsed time since Start or the first Next, until tapped to reset. */
function useTalkTimer() {
  const [start, setStart] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!start) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [start]);
  const s = start ? Math.floor((Date.now() - start) / 1000) : 0;
  return {
    text: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`,
    running: !!start,
    begin: () => setStart((v) => v || Date.now()),
    reset: () => setStart(0),
  };
}

/** Slides: next and previous big enough to hit without looking, start,
 *  black, end, a talk timer, and the phone as a pointer. */
export function PresentPanel({ ctx }: { ctx: Ctx }) {
  const { os, speed } = useSettings();
  const timer = useTalkTimer();
  const air = useAirPointer(ctx, speed);
  const [note, setNote] = useState('');

  const key = (usage: number, mods = 0) => () => ctx.tapKey(Page.keyboard, usage, mods);
  const next = () => {
    timer.begin();
    key(KEY.pageDown)();
  };
  // PowerPoint's "from the beginning": F5 on Windows, Cmd+Shift+Return on a Mac.
  const startShow = () => {
    timer.begin();
    if (os === 'mac') key(KEY.enter, Mod.gui | Mod.shift)();
    else key(KEY.f1 + 4)();
  };

  const big = (label: string, icon: ReactNode, onClick: () => void, cls: string) => (
    <button className={`present-big ${cls}`} aria-label={label} onClick={onClick}>
      <Tick />
      {icon}
      <span>{label}</span>
    </button>
  );
  const small = (label: string, onClick: () => void) => (
    <button className="tile" onClick={onClick}>
      <Tick />
      {label}
    </button>
  );

  return (
    <div className="present-panel">
      <div className="present-row">
        {big('Previous', <ChevronLeft />, key(KEY.pageUp), 'prev')}
        {big('Next', <ChevronRight />, next, 'next')}
      </div>
      <div className="present-tools">
        {small('Start', startShow)}
        {small('Black', key(letter('b')))}
        {small('End', key(KEY.esc))}
        <button
          className={timer.running ? 'tile present-timer running' : 'tile present-timer'}
          aria-label="Talk timer, tap to reset"
          onClick={() => {
            haptic();
            timer.reset();
          }}
        >
          <Tick />
          {timer.text}
        </button>
      </div>
      <button
        className={air.on ? 'present-air on' : 'present-air'}
        onClick={() => {
          haptic();
          void air.toggle().then(setNote);
        }}
      >
        <Tick />
        {air.on ? 'Air pointer on - hold the phone upright and point. Tap to stop.' : 'Air pointer'}
      </button>
      {note && (
        <p className="panel-note" onClick={() => setNote('')}>
          {note}
        </p>
      )}
    </div>
  );
}
