import { useEffect, useMemo, useRef, type PointerEvent } from 'react';
import type { Ctx } from '../App';
import { NexusLink, link } from '../ble/link';
import { ChevronDown, ChevronUp } from '../icons';
import { Gestures, type Intent } from '../protocol/gestures';
import { Button, KeyAction, Page } from '../protocol/packets';
import { haptic, useSettings } from '../settings';
import { Tick } from '../ui';

/** Finger travel on the side strip per wheel notch, before the speed setting. */
const STRIP_PX = 18;

export function Trackpad({ ctx, echo, buttons }: { ctx: Ctx; echo: string; buttons: boolean }) {
  const s = useSettings();
  const gestures = useMemo(() => new Gestures({ tapToClick: true, longPressRight: false }), []);
  gestures.opts = { tapToClick: s.tapToClick, longPressRight: s.longPressRight };
  const lastMove = useRef(0);
  const stripY = useRef<number | null>(null);

  // Nothing stays held when the trackpad goes away.
  useEffect(() => () => ctx.mouse.releaseAll(), [ctx.mouse]);

  const click = async (bit: number) => {
    haptic();
    const mods = ctx.takeMods();
    // Ctrl-click and friends: the modifiers go down first, and only once
    // NEXUS has them does the click go - the mouse lane would overtake.
    if (mods) await link.key(KeyAction.press, mods, Page.keyboard, 0).catch(() => undefined);
    ctx.mouse.click(bit);
    if (mods) setTimeout(() => void link.key(KeyAction.release, mods, Page.keyboard, 0).catch(() => undefined), 80);
  };

  // HID wheel up is positive. Natural scrolling moves the content with the
  // finger, so a finger going up scrolls the view down.
  const scroll = (fingerDx: number, fingerDy: number) => {
    const k = s.scroll / 24;
    const sign = s.natural ? 1 : -1;
    ctx.mouse.scroll(-sign * fingerDx * k, sign * fingerDy * k);
  };

  const apply = (out: Intent[], t: number) => {
    for (const o of out) {
      if (o.kind === 'move') {
        const dt = Math.max(1, t - lastMove.current);
        lastMove.current = t;
        // Speed in px/ms: slow strokes stay precise, fast ones cross the screen.
        const v = Math.hypot(o.dx, o.dy) / dt;
        const gain = s.speed * (1 + s.accel * Math.min(Math.max(v - 0.25, 0), 3));
        ctx.mouse.move(o.dx * gain, o.dy * gain);
      } else if (o.kind === 'scroll') {
        scroll(o.dx, o.dy);
      } else if (o.kind === 'click') {
        void click(o.button);
      } else {
        haptic();
        ctx.mouse.set(Button.left, o.down);
      }
    }
  };

  const onPad = (type: 'down' | 'move' | 'up' | 'cancel') => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (type === 'down') {
      e.currentTarget.setPointerCapture(e.pointerId);
      lastMove.current = e.timeStamp;
    }
    apply(gestures.handle({ type, id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }), e.timeStamp);
  };

  // The side strip: one finger, vertical only, like a scroll wheel you drag.
  const strip = {
    onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      stripY.current = e.clientY;
    },
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
      if (stripY.current === null) return;
      const dy = e.clientY - stripY.current;
      stripY.current = e.clientY;
      scroll(0, (dy * 24) / STRIP_PX);
    },
    onPointerUp: () => (stripY.current = null),
    onPointerCancel: () => (stripY.current = null),
  };

  const notch = (up: boolean) => {
    haptic();
    ctx.mouse.scroll(0, up ? 3 : -3);
  };

  const hold = (bit: number) => ({
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault();
      haptic();
      ctx.mouse.set(bit, true);
    },
    onPointerUp: () => ctx.mouse.set(bit, false),
    onPointerCancel: () => ctx.mouse.set(bit, false),
    onPointerLeave: () => {
      if (ctx.mouse.held & bit) ctx.mouse.set(bit, false);
    },
  });

  return (
    <div className="surface">
      <div
        className="pad"
        aria-label="Trackpad"
        onPointerDown={onPad('down')}
        onPointerMove={onPad('move')}
        onPointerUp={onPad('up')}
        onPointerCancel={onPad('cancel')}
        onContextMenu={(e) => e.preventDefault()}
      >
        {echo ? (
          <span className="echo">{echo}</span>
        ) : (
          link.state !== 'connected' && <ConnectCard />
        )}
      </div>

      <div className={buttons ? 'scroll-strip' : 'scroll-strip full'} aria-label="Scroll" {...strip}>
        <button aria-label="Scroll up" onPointerDown={(e) => e.stopPropagation()} onClick={() => notch(true)}>
          <Tick />
          <ChevronUp />
        </button>
        <button aria-label="Scroll down" onPointerDown={(e) => e.stopPropagation()} onClick={() => notch(false)}>
          <Tick />
          <ChevronDown />
        </button>
      </div>

      {buttons && (
        <div className="mouse-buttons">
          <button aria-label="Left click" {...hold(Button.left)}>
            <Tick />
          </button>
          <button aria-label="Middle click" {...hold(Button.middle)}>
            <Tick />
          </button>
          <button aria-label="Right click" {...hold(Button.right)}>
            <Tick />
          </button>
        </div>
      )}
    </div>
  );
}

/** Not connected: one clear way back, and what to do when NEXUS is not offered. */
function ConnectCard() {
  if (!NexusLink.supported()) return <span className="pad-hint">Open this page in Chrome, or Bluefy on iPhone</span>;
  if (link.state !== 'idle') return <span className="pad-hint">{link.state === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span>;
  return (
    <div className="connect-card" onPointerDown={(e) => e.stopPropagation()}>
      <button
        className="connect-button"
        onClick={() => {
          haptic();
          void link.pick();
        }}
      >
        <Tick />
        Connect to NEXUS
      </button>
      <span className="connect-help">Not in the list? On NEXUS open Settings → PHONE → PAIR, then try again.</span>
    </div>
  );
}
