import { useEffect, useRef, useState, type ReactNode } from 'react';
import { link } from '../ble/link';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClockIcon,
  DropIcon,
  GridIcon,
  HomeIcon,
  PaletteIcon,
  RotateIcon,
  SaveIcon,
  SlidersIcon,
} from '../icons';
import { Act, Ctrl, Output } from '../protocol/packets';
import { haptic } from '../settings';
import { Segmented } from '../ui';

/** Sent while a button is held, inside NEXUS's 1 s hold timeout. */
const KEEPALIVE_MS = 400;

const send = (op: number, ...args: number[]) => void link.control(op, ...args).catch(() => undefined);

/**
 * A NEXUS action, pressed and released like a key on the game layer: a held
 * arrow repeats on the dongle, a held soft drop keeps dropping. NEXUS lets
 * go by itself if the phone goes quiet, so a lost release cannot stick.
 */
function Hold(props: { act: number; label: string; className: string; disabled: boolean; children: ReactNode }) {
  const [down, setDown] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const held = useRef(false);

  const release = () => {
    if (!held.current) return;
    held.current = false;
    clearInterval(timer.current);
    setDown(false);
    send(Ctrl.action, props.act, 0);
  };
  // Leaving the panel mid-press still lets go.
  useEffect(() => release, []);

  return (
    <button
      className={`${props.className}${down ? ' held' : ''}`}
      aria-label={props.label}
      disabled={props.disabled}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        haptic();
        held.current = true;
        setDown(true);
        send(Ctrl.action, props.act, 1);
        timer.current = setInterval(() => send(Ctrl.keepalive), KEEPALIVE_MS);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        send(Ctrl.action, props.act, 1);
        send(Ctrl.action, props.act, 0);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {props.children}
    </button>
  );
}

/** The keyboard's game layer on the phone: NEXUS's menus and games, and where keys go. */
export function DonglePanel() {
  const s = link.status;
  const ready = link.state === 'connected' && !!s?.features.dongle;
  const off = !ready;

  // The output the user just picked, until NEXUS confirms it.
  const [want, setWant] = useState(0);
  useEffect(() => {
    if (!want) return;
    if (s?.output === want) setWant(0);
    const t = setTimeout(() => setWant(0), 2000);
    return () => clearTimeout(t);
  }, [want, s?.output]);
  const output = want || s?.output || Output.usb;

  const nav = (act: number, label: string, icon: ReactNode) => (
    <Hold act={act} label={label} className="chip" disabled={off}>
      {icon}
      <span>{label}</span>
    </Hold>
  );

  return (
    <div className="dongle-panel">
      {link.state === 'connected' && !s?.features.dongle && (
        <p className="dongle-note">Update the NEXUS firmware to control the dongle from here.</p>
      )}

      <div className="chips">
        {nav(Act.back, 'Back', <ChevronLeft />)}
        {nav(Act.home, 'Home', <HomeIcon />)}
        {nav(Act.gameCenter, 'Games', <GridIcon />)}
        {nav(Act.menu, 'Menu', <SlidersIcon />)}
        {s?.features.host && nav(Act.host, 'Host', <ClockIcon />)}
      </div>

      <div className="pad-row">
        <div className="dpad">
          <Hold act={Act.up} label="Up" className="dpad-zone n" disabled={off}>
            <ChevronUp />
          </Hold>
          <Hold act={Act.down} label="Down" className="dpad-zone s" disabled={off}>
            <ChevronDown />
          </Hold>
          <Hold act={Act.left} label="Left" className="dpad-zone w" disabled={off}>
            <ChevronLeft />
          </Hold>
          <Hold act={Act.right} label="Right" className="dpad-zone e" disabled={off}>
            <ChevronRight />
          </Hold>
          <Hold act={Act.select} label="Select" className="dpad-center" disabled={off}>
            OK
          </Hold>
        </div>

        <div className="face">
          <div className="face-button rotate">
            <Hold act={Act.rotate} label="Rotate" className="round big" disabled={off}>
              <RotateIcon />
            </Hold>
            <span>Rotate</span>
          </div>
          <div className="face-button drop">
            <Hold act={Act.drop} label="Drop" className="round big tinted" disabled={off}>
              <DropIcon />
            </Hold>
            <span>Drop</span>
          </div>
        </div>
      </div>

      <div className="dongle-bottom">
        <div className={off ? 'output disabled' : 'output'}>
          <span className="mini-label">Output</span>
          <Segmented
            label="Output"
            value={String(output)}
            options={[
              [String(Output.usb), 'USB'],
              [String(Output.ble), 'BLE'],
            ]}
            onChange={(v) => {
              if (off) return;
              setWant(Number(v));
              send(Ctrl.output, Number(v));
            }}
          />
        </div>
        <div className="theme-step">
          <Hold act={Act.themePrev} label="Previous theme" className="step" disabled={off}>
            <ChevronLeft />
          </Hold>
          <span className="theme-label">
            <PaletteIcon />
            Theme
          </span>
          <Hold act={Act.themeNext} label="Next theme" className="step" disabled={off}>
            <ChevronRight />
          </Hold>
        </div>
        <Hold act={Act.save} label="Save settings" className="round small" disabled={off}>
          <SaveIcon />
        </Hold>
      </div>
    </div>
  );
}
