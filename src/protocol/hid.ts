// HID usages the UI sends. Keyboard page 0x07, consumer page 0x0C.
import { Mod, Page } from './packets';

export interface KeyDef {
  label: string;
  page: number;
  usage: number;
  mods?: number;
}

const k = (label: string, usage: number, mods = 0): KeyDef => ({ label, page: Page.keyboard, usage, mods });

export const KEY = {
  enter: 0x28,
  esc: 0x29,
  backspace: 0x2a,
  tab: 0x2b,
  space: 0x2c,
  printScreen: 0x46,
  insert: 0x49,
  home: 0x4a,
  pageUp: 0x4b,
  del: 0x4c,
  end: 0x4d,
  pageDown: 0x4e,
  right: 0x4f,
  left: 0x50,
  down: 0x51,
  up: 0x52,
  f1: 0x3a,
} as const;

/** Keyboard usage for a letter or digit, for shortcuts. */
export function letter(ch: string): number {
  const code = ch.toLowerCase().charCodeAt(0);
  if (code >= 97 && code <= 122) return 0x04 + code - 97;
  if (code === 48) return 0x27;
  if (code >= 49 && code <= 57) return 0x1e + code - 49;
  throw new Error(`no usage for ${ch}`);
}

export const SPECIAL_KEYS: KeyDef[] = [
  k('Esc', KEY.esc),
  k('Tab', KEY.tab),
  k('Enter', KEY.enter),
  k('⌫', KEY.backspace),
  k('Del', KEY.del),
  k('←', KEY.left),
  k('↑', KEY.up),
  k('↓', KEY.down),
  k('→', KEY.right),
  k('Home', KEY.home),
  k('End', KEY.end),
  k('PgUp', KEY.pageUp),
  k('PgDn', KEY.pageDown),
  k('Ins', KEY.insert),
  k('PrtSc', KEY.printScreen),
  ...Array.from({ length: 12 }, (_, i) => k(`F${i + 1}`, KEY.f1 + i)),
];

export type HostOs = 'windows' | 'mac' | 'linux';

/** The primary shortcut modifier: Cmd on a Mac, Ctrl elsewhere. */
const primary = (os: HostOs) => (os === 'mac' ? Mod.gui : Mod.ctrl);

export function shortcuts(os: HostOs): KeyDef[] {
  const p = primary(os);
  const mac = os === 'mac';
  return [
    k('Copy', letter('c'), p),
    k('Paste', letter('v'), p),
    k('Cut', letter('x'), p),
    k('Undo', letter('z'), p),
    mac ? k('Redo', letter('z'), p | Mod.shift) : k('Redo', letter('y'), p),
    k('Select all', letter('a'), p),
    k('Save', letter('s'), p),
    k('Find', letter('f'), p),
    k('Switch app', KEY.tab, mac ? Mod.gui : Mod.alt),
    mac ? k('Desktop', 0x44 /* F11 */) : k('Desktop', letter('d'), Mod.gui),
    mac ? k('Lock', letter('q'), Mod.ctrl | Mod.gui) : k('Lock', letter('l'), Mod.gui),
    mac ? k('Close', letter('w'), Mod.gui) : k('Close', 0x3d /* F4 */, Mod.alt),
    k('New tab', letter('t'), p),
    k('Close tab', letter('w'), p),
    k('Next tab', KEY.tab, Mod.ctrl),
    mac ? k('Force quit', KEY.esc, Mod.gui | Mod.alt) : k('Task mgr', KEY.esc, Mod.ctrl | Mod.shift),
  ];
}

// US layout: printable ASCII -> keyboard usage, and whether Shift is needed.
// The same table the NEXUS firmware types text with (src/remote/remote_proto.c).
// SHIFTED[i] is Shift + UNSHIFTED[i]; the space has no shifted twin.
const UNSHIFTED = "`1234567890-=[]\\;',./ ";
const SHIFTED = '~!@#$%^&*()_+{}|:"<>?';
const USAGE_OF: Record<string, number> = {
  '`': 0x35,
  '-': 0x2d,
  '=': 0x2e,
  '[': 0x2f,
  ']': 0x30,
  '\\': 0x31,
  ';': 0x33,
  "'": 0x34,
  ',': 0x36,
  '.': 0x37,
  '/': 0x38,
  ' ': 0x2c,
};

/** The key and Shift state that type @p ch on a US keyboard, or null. */
export function asciiKey(ch: string): { usage: number; shift: boolean } | null {
  if (/^[a-z0-9]$/.test(ch)) return { usage: letter(ch), shift: false };
  if (/^[A-Z]$/.test(ch)) return { usage: letter(ch), shift: true };
  const i = SHIFTED.indexOf(ch);
  if (ch.length === 1 && i >= 0) return { usage: asciiKey(UNSHIFTED[i])!.usage, shift: true };
  if (ch.length === 1 && UNSHIFTED.includes(ch)) return { usage: USAGE_OF[ch], shift: false };
  return null;
}
