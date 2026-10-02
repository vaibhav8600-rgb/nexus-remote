import { useState } from 'react';
import type { Ctx } from '../App';
import { link } from '../ble/link';
import { SPECIAL_KEYS, shortcuts } from '../protocol/hid';
import { haptic, useSettings } from '../settings';
import { Tick } from '../ui';

/** Snippet tiles show their start; the whole text is typed. */
const preview = (t: string) => (t.length > 18 ? `${t.slice(0, 17)}…` : t);

/** Paste and snippets first - text from the phone - then shortcuts, then
 *  every key a phone keyboard lacks. */
export function KeysPanel({ ctx }: { ctx: Ctx }) {
  const { os, snippets } = useSettings();
  const [note, setNote] = useState('');

  const type = (text: string) => {
    haptic();
    link.typeText(text);
  };

  const paste = async () => {
    haptic();
    try {
      const text = await navigator.clipboard.readText();
      if (text) link.typeText(text);
      else setNote('The clipboard is empty.');
    } catch {
      // No clipboard read here (some wrapper browsers), or it was declined.
      setNote('This browser will not share the clipboard. Long-press the keyboard field and paste there.');
    }
  };

  return (
    <div className="keys-panel">
      <div className="tiles">
        <button className="tile text-tile wide" onClick={() => void paste()}>
          <Tick />
          Paste from phone
        </button>
        {snippets.map((t, i) => (
          <button key={i} className="tile text-tile" onClick={() => type(t)}>
            <Tick />
            {preview(t)}
          </button>
        ))}
      </div>
      {note && (
        <p className="panel-note" onClick={() => setNote('')}>
          {note}
        </p>
      )}
      <div className="tiles spaced">
        {shortcuts(os).map((k) => (
          <button key={k.label} className="tile" onClick={() => ctx.tapKey(k.page, k.usage, k.mods)}>
            <Tick />
            {k.label}
          </button>
        ))}
      </div>
      <div className="tiles keys">
        {SPECIAL_KEYS.map((k) => (
          <button key={k.label} className="tile" onClick={() => ctx.tapKey(k.page, k.usage)}>
            <Tick />
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
