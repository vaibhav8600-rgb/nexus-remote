import { forwardRef, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { Ctx } from '../App';
import { link } from '../ble/link';
import { KEY, letter } from '../protocol/hid';
import { Mod, Page } from '../protocol/packets';
import { useSettings } from '../settings';

// The field always holds one character, so a Backspace on an otherwise empty
// field still has something to delete - and still fires.
const SEED = ' ';

/**
 * The phone's own keyboard, driven through an invisible field. Android
 * keyboards with autocorrect do not send reliable key events, so the field is
 * diffed instead: what vanished becomes Backspaces, what appeared is typed.
 */
export const LiveInput = forwardRef<
  HTMLInputElement,
  { ctx: Ctx; onEcho: (text: string, erased: number) => void; onBlur: () => void }
>(function LiveInput({ ctx, onEcho, onBlur }, ref) {
  const [value, setValue] = useState(SEED);
  const prev = useRef(SEED);

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    const old = prev.current;
    let same = 0;
    while (same < old.length && same < next.length && old[same] === next[same]) same++;
    const erased = old.length - same;
    const added = next.slice(same);

    for (let i = 0; i < erased; i++) ctx.tapKey(Page.keyboard, KEY.backspace);
    // With a sticky modifier armed, one letter is a shortcut: Ctrl, then c.
    if (added.length === 1 && (ctx.mods.once || ctx.mods.locked) && /[a-z0-9]/i.test(added)) {
      ctx.tapKey(Page.keyboard, letter(added));
    } else if (added) {
      link.typeText(added);
    }
    onEcho(added, erased);

    const keep = next.length === 0 || next.length > 48 ? SEED : next;
    prev.current = keep;
    setValue(keep);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ctx.tapKey(Page.keyboard, KEY.enter);
      onEcho('\n', 0);
    }
  };

  return (
    <input
      ref={ref}
      className="live-input"
      value={value}
      onChange={onChange}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      autoCapitalize="off"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="send"
      aria-label="Type on the computer"
    />
  );
});

/** The keys a phone keyboard does not have, above it. */
export function KeyStrip({ ctx }: { ctx: Ctx }) {
  const { os } = useSettings();
  const mac = os === 'mac';
  const mods: [string, number][] = [
    [mac ? '⌃' : 'Ctrl', Mod.ctrl],
    [mac ? '⌥' : 'Alt', Mod.alt],
    [mac ? '⌘' : os === 'windows' ? 'Win' : 'Super', Mod.gui],
    ['⇧', Mod.shift],
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

  return (
    <div className="key-strip" onPointerDown={(e) => e.preventDefault() /* keep the phone keyboard up */}>
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
    </div>
  );
}
