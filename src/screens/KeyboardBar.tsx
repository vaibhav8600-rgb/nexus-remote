import { useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { Ctx } from '../App';
import { link } from '../ble/link';
import { KEY, asciiKey } from '../protocol/hid';
import { Mod, Page } from '../protocol/packets';
import { haptic, useSettings } from '../settings';

type Echo = (text: string, erased: number) => void;
type Layer = 'abc' | '123' | 'sym';
type Shift = 'off' | 'once' | 'lock';

// The US layout, laid out the way a phone keyboard is. Every character here
// is one the dongle can type; see asciiKey().
const ROWS: Record<Layer, [string, string, string]> = {
  abc: ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'],
  '123': ['1234567890', '-/:;()$&@"', ".,?!'"],
  sym: ['[]{}#%^*+=', '_\\|~<>`', ".,?!'"],
};

const DOUBLE_TAP_MS = 300;
const REPEAT_DELAY_MS = 450;
const REPEAT_MS = 70;

/**
 * A phone-style QWERTY that sends real key presses, not text: so it works
 * with Ctrl, Alt and Win from the strip above, and with any app on the
 * computer, exactly as a hardware keyboard would.
 */
export function Qwerty({ ctx, onEcho }: { ctx: Ctx; onEcho: Echo }) {
  const [layer, setLayer] = useState<Layer>('abc');
  const [shift, setShift] = useState<Shift>('off');
  const lastShift = useRef(0);
  const repeat = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rows = ROWS[layer];
  const upper = layer === 'abc' && shift !== 'off';

  const type = (ch: string) => {
    const key = asciiKey(ch);
    if (!key) return;
    let withShift = key.shift;
    // With Caps Lock on the computer, a letter needs Shift to stay lower case.
    if (/[a-z]/i.test(ch) && link.status?.capsLock) withShift = !withShift;
    ctx.tapKey(Page.keyboard, key.usage, withShift ? Mod.shift : 0);
    onEcho(ch, 0);
    if (shift === 'once') setShift('off');
  };

  const onShift = () => {
    const now = performance.now();
    if (shift === 'lock') setShift('off');
    else if (shift === 'once' && now - lastShift.current < DOUBLE_TAP_MS) setShift('lock');
    else setShift(shift === 'off' ? 'once' : 'off');
    lastShift.current = now;
  };

  const backspace = () => {
    ctx.tapKey(Page.keyboard, KEY.backspace);
    onEcho('', 1);
  };
  const stopRepeat = () => clearTimeout(repeat.current);
  const holdBackspace = {
    onPointerDown: (e: PointerEvent) => {
      e.preventDefault();
      backspace();
      const again = () => {
        backspace();
        repeat.current = setTimeout(again, REPEAT_MS);
      };
      repeat.current = setTimeout(again, REPEAT_DELAY_MS);
    },
    onPointerUp: stopRepeat,
    onPointerCancel: stopRepeat,
    onPointerLeave: stopRepeat,
  };

  const chars = (row: string) =>
    [...row].map((c) => {
      const shown = upper ? c.toUpperCase() : c;
      return <CharKey key={c} label={shown} onType={() => type(shown)} />;
    });

  return (
    <div className="qwerty" onContextMenu={(e) => e.preventDefault()}>
      <div className="kb-row">{chars(rows[0])}</div>
      <div className={layer === 'abc' ? 'kb-row inset' : 'kb-row'}>{chars(rows[1])}</div>
      <div className="kb-row">
        {layer === 'abc' ? (
          <Special wide label="Shift" active={shift !== 'off'} onClick={onShift}>
            {shift === 'lock' ? '⇪' : '⇧'}
          </Special>
        ) : (
          <Special wide label="More symbols" onClick={() => setLayer(layer === '123' ? 'sym' : '123')}>
            {layer === '123' ? '#+=' : '123'}
          </Special>
        )}
        <div className="kb-group">{chars(rows[2])}</div>
        <button className="kb-key special wide" aria-label="Delete" {...holdBackspace}>
          ⌫
        </button>
      </div>
      <div className="kb-row">
        <Special
          label={layer === 'abc' ? 'Numbers' : 'Letters'}
          onClick={() => setLayer(layer === 'abc' ? '123' : 'abc')}
        >
          {layer === 'abc' ? '123' : 'ABC'}
        </Special>
        <button className="kb-key space" onPointerDown={() => haptic()} onClick={() => type(' ')}>
          space
        </button>
        <Special
          label="Return"
          onClick={() => {
            ctx.tapKey(Page.keyboard, KEY.enter);
            onEcho('\n', 0);
          }}
        >
          return
        </Special>
      </div>
    </div>
  );
}

/** A character key, with the callout a phone shows above your finger. */
function CharKey({ label, onType }: { label: string; onType: () => void }) {
  const [down, setDown] = useState(false);
  return (
    <button
      className={down ? 'kb-key down' : 'kb-key'}
      onPointerDown={() => {
        haptic();
        setDown(true);
      }}
      onPointerUp={() => setDown(false)}
      onPointerCancel={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      onClick={onType}
    >
      {label}
      {down && (
        <span className="kb-callout" aria-hidden="true">
          {label}
        </span>
      )}
    </button>
  );
}

function Special(props: { label: string; onClick: () => void; children: ReactNode; wide?: boolean; active?: boolean }) {
  return (
    <button
      className={`kb-key special${props.wide ? ' wide' : ''}${props.active ? ' active' : ''}`}
      aria-label={props.label}
      aria-pressed={props.active}
      onClick={() => {
        haptic();
        props.onClick();
      }}
    >
      {props.children}
    </button>
  );
}

/** The keys a phone keyboard does not have, above it - and Paste. */
export function KeyStrip({ ctx, onEcho }: { ctx: Ctx; onEcho: Echo }) {
  const { os } = useSettings();
  const mac = os === 'mac';
  const mods: [string, number][] = [
    [mac ? '⌃' : 'Ctrl', Mod.ctrl],
    [mac ? '⌥' : 'Alt', Mod.alt],
    [mac ? '⌘' : os === 'windows' ? 'Win' : 'Super', Mod.gui],
  ];
  const keys: [string, number][] = [
    ['Esc', KEY.esc],
    ['Tab', KEY.tab],
    ['←', KEY.left],
    ['↑', KEY.up],
    ['↓', KEY.down],
    ['→', KEY.right],
    ['Del', KEY.del],
    ['Home', KEY.home],
    ['End', KEY.end],
  ];

  // The phone's clipboard, typed out by NEXUS - for anything longer than a
  // few words. Browsers ask permission the first time.
  const paste = async () => {
    haptic();
    try {
      const text = await navigator.clipboard.readText();
      link.typeText(text);
      onEcho(text.slice(-24), 0);
    } catch {
      onEcho('Clipboard not available', 0);
    }
  };

  return (
    <div className="key-strip">
      {mods.map(([label, bit]) => (
        <button
          key={label}
          className={ctx.mods.locked & bit ? 'locked' : ctx.mods.once & bit ? 'armed' : ''}
          aria-pressed={!!((ctx.mods.once | ctx.mods.locked) & bit)}
          onClick={() => ctx.tapModifier(bit)}
        >
          {label}
        </button>
      ))}
      <span className="divider" />
      {keys.map(([label, usage]) => (
        <button key={label} onClick={() => ctx.tapKey(Page.keyboard, usage)}>
          {label}
        </button>
      ))}
      <span className="divider" />
      <button onClick={() => void paste()}>Paste</button>
    </div>
  );
}
