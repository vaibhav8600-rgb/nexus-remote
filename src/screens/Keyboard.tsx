import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { Ctx } from '../App';
import { link } from '../ble/link';
import { KEY, SPECIAL_KEYS, shortcuts } from '../protocol/hid';
import { Page } from '../protocol/packets';
import { useSettings } from '../settings';
import { Section } from '../ui';
import { ModRow } from './ModRow';

// Live mode keeps one character in the field, so a Backspace on an
// otherwise empty field still has something to delete - and still fires.
const SEED = ' ';

export function Keyboard({ ctx }: { ctx: Ctx }) {
  const { os } = useSettings();
  const [draft, setDraft] = useState('');
  const [live, setLive] = useState(SEED);
  const prev = useRef(SEED);
  const connected = link.state === 'connected';

  const send = () => {
    link.typeText(draft);
    setDraft('');
  };

  // Android keyboards with autocorrect do not send reliable key events, so
  // the field is diffed instead: what vanished becomes Backspaces, what
  // appeared is typed. Both go through NEXUS's one ordered queue.
  const onLive = (e: ChangeEvent<HTMLInputElement>) => {
    const next = e.target.value;
    const old = prev.current;
    let same = 0;
    while (same < old.length && same < next.length && old[same] === next[same]) same++;
    for (let i = same; i < old.length; i++) ctx.tapKey(Page.keyboard, KEY.backspace);
    const added = next.slice(same);
    if (added) link.typeText(added);

    const keep = next.length === 0 || next.length > 48 ? SEED : next;
    prev.current = keep;
    setLive(keep);
  };

  const onLiveKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ctx.tapKey(Page.keyboard, KEY.enter);
    }
  };

  const pending = link.textPending;
  const total = link.textQueued;
  const typing = pending > 0 || !!link.status?.typing;

  return (
    <>
      <Section header="Send Text" footer="NEXUS types it out on a US layout. Emoji and accented letters are skipped.">
        <textarea
          className="field"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type or paste here"
          rows={3}
        />
        <div className="cell">
          {typing ? (
            <>
              <progress className="progress" max={total || 1} value={total - pending} />
              <button className="text-button destructive" onClick={() => link.cancelText()}>
                Cancel
              </button>
            </>
          ) : (
            <span className="cell-label secondary">{draft.length ? `${draft.length} characters` : 'Nothing to send'}</span>
          )}
          <button className="filled small" disabled={!connected || !draft} onClick={send}>
            Send
          </button>
        </div>
      </Section>

      <Section header="Live Typing" footer="Every key you type here goes straight to the computer.">
        <input
          className="field"
          value={live}
          onChange={onLive}
          onKeyDown={onLiveKey}
          placeholder="Tap to type"
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={!connected}
          aria-label="Live typing"
        />
      </Section>

      <Section header="Modifiers" footer="Tap once for the next key. Tap twice to lock.">
        <div className="cell">
          <ModRow ctx={ctx} />
        </div>
      </Section>

      <Section header="Keys">
        <div className="keygrid">
          {SPECIAL_KEYS.map((k) => (
            <button key={k.label} className="keycap" onClick={() => ctx.tapKey(k.page, k.usage)}>
              {k.label}
            </button>
          ))}
        </div>
      </Section>

      <Section header="Shortcuts" footer={`For ${os === 'mac' ? 'macOS' : os === 'linux' ? 'Linux' : 'Windows'} - change it in Settings.`}>
        <div className="chips">
          {shortcuts(os).map((k) => (
            <button key={k.label} className="chip" onClick={() => ctx.tapKey(k.page, k.usage, k.mods)}>
              {k.label}
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}
