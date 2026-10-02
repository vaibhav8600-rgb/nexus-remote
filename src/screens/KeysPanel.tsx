import type { Ctx } from '../App';
import { SPECIAL_KEYS, shortcuts } from '../protocol/hid';
import { useSettings } from '../settings';
import { Tick } from '../ui';

/** Shortcuts first - they are what this panel is opened for - then every key
 *  a phone keyboard lacks. */
export function KeysPanel({ ctx }: { ctx: Ctx }) {
  const { os } = useSettings();
  return (
    <div className="keys-panel">
      <div className="tiles">
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
