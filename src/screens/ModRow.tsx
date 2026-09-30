import type { Ctx } from '../App';
import { Mod } from '../protocol/packets';
import { useSettings } from '../settings';

/** Sticky modifiers: tap for the next key, tap again to lock, again to release. */
export function ModRow({ ctx }: { ctx: Ctx }) {
  const { os } = useSettings();
  const mods: [string, number][] = [
    [os === 'mac' ? '⌃ control' : 'Ctrl', Mod.ctrl],
    [os === 'mac' ? '⇧ shift' : 'Shift', Mod.shift],
    [os === 'mac' ? '⌥ option' : 'Alt', Mod.alt],
    [os === 'mac' ? '⌘ command' : os === 'windows' ? 'Win' : 'Super', Mod.gui],
  ];
  return (
    <div className="mods">
      {mods.map(([label, bit]) => {
        const state = ctx.mods.locked & bit ? 'locked' : ctx.mods.once & bit ? 'armed' : '';
        return (
          <button key={bit} className={`pill ${state}`} aria-pressed={!!state} onClick={() => ctx.tapModifier(bit)}>
            {label}
          </button>
        );
      })}
    </div>
  );
}
