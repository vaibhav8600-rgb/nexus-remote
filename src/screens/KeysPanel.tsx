import type { Ctx } from '../App';
import { SPECIAL_KEYS, shortcuts } from '../protocol/hid';
import { useSettings } from '../settings';

/** Shortcuts first - they are what this panel is opened for - then every key
 *  a phone keyboard lacks. */
export function KeysPanel({ ctx }: { ctx: Ctx }) {
  const { os } = useSettings();
  return (
    <div className="keys-panel">
      <div className="tiles">
        {shortcuts(os).map((k) => (
          <button key={k.label} className="tile" onClick={() => ctx.tapKey(k.page, k.usage, k.mods)}>
            {k.label}
          </button>
        ))}
      </div>
      <div className="tiles keys">
        {SPECIAL_KEYS.map((k) => (
          <button key={k.label} className="tile" onClick={() => ctx.tapKey(k.page, k.usage)}>
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
