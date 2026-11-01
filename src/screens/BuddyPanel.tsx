import { useEffect, useRef, useState } from 'react';
import { link } from '../ble/link';
import { BUDDY_NAME, ask, clockLines, command, faceLines, remember, type Turn } from '../buddy/brain';
import { haptic, updateSettings, useSettings } from '../settings';
import { Tick } from '../ui';

interface Msg {
  from: 'you' | 'buddy' | 'note';
  text: string;
  emotion?: string;
}

// The conversation outlives the panel: closing it to move the pointer and
// coming back should not make Buddy forget. Gone when the app is.
let turns: Turn[] = [];
let log: Msg[] = [];
let trick: ReturnType<typeof setTimeout> | undefined;

/** A trick's steps to the dongle, about two seconds apart. A new one cuts
 *  off any still playing. */
function play(steps: string[][]) {
  clearTimeout(trick);
  const next = (i: number) => {
    if (i >= steps.length || !faceUp()) return;
    const lines = (i === 0 ? ['B 1', ...steps[i]] : steps[i]).join('\n');
    void link.buddy(`${lines}\n`).catch(() => undefined);
    trick = setTimeout(() => next(i + 1), 1800);
  };
  next(0);
}

/** Whether this NEXUS can show Buddy's side of it. */
const faceUp = () => link.state === 'connected' && !!link.status?.features.buddy;

/** Chat with Buddy: Gemini answers here, the dongle shows the face and line. */
export function BuddyPanel() {
  const s = useSettings();
  const [msgs, setMsgs] = useState(log);
  const [draft, setDraft] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  // A block, not an arrow's value: newer Chrome returns a Promise from
  // scrollIntoView, and React would take it for a cleanup and crash.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [msgs, busy]);

  const add = (m: Msg) => {
    log = [...log, m].slice(-40);
    setMsgs(log);
  };

  const send = async () => {
    const said = draft.trim();
    if (!said || busy) return;
    haptic();
    setDraft('');
    add({ from: 'you', text: said });
    // A face or a trick: acted out at once, no Gemini.
    const c = command(said);
    if (c) {
      const first = c.steps[0].find((l) => l.startsWith('E '));
      add({ from: 'buddy', text: c.reply, emotion: first ? first.slice(2).toLowerCase() : 'happy' });
      play(c.steps);
      return;
    }
    setBusy(true);
    // B 1 takes the face for the phone; the clock rides along for quiet hours.
    if (faceUp()) void link.buddy(`B 1\n${clockLines()}E THINKING\n`).catch(() => undefined);
    try {
      const a = await ask(s.geminiKey, turns, said.slice(0, 500));
      turns = remember(turns, said, a);
      add({ from: 'buddy', text: a.reply, emotion: a.emotion });
      if (faceUp()) void link.buddy(faceLines(a)).catch(() => undefined);
    } catch (e) {
      add({ from: 'note', text: (e as Error).message });
      if (faceUp()) void link.buddy('E SAD\nS MY BRAIN IS FOGGY...\n').catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  if (!s.geminiKey) {
    const save = () => keyDraft.trim() && updateSettings({ geminiKey: keyDraft.trim() });
    return (
      <div className="buddy-panel">
        <p className="panel-note">
          {BUDDY_NAME} talks through Gemini with your own key, kept on this phone and sent only to Google. Get one at{' '}
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
            aistudio.google.com/apikey
          </a>
          .
        </p>
        <div className="buddy-input">
          <input
            type="password"
            autoComplete="off"
            placeholder="Gemini API key"
            aria-label="Gemini API key"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && save()}
          />
          <button className="text-button bold" disabled={!keyDraft.trim()} onClick={save}>
            <Tick />
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="buddy-panel">
      <div className="buddy-log" aria-live="polite">
        {msgs.length === 0 && (
          <p className="panel-note">
            Say hi to {BUDDY_NAME}.{' '}
            {faceUp() ? 'The dongle shows the face and a short line.' : 'Connect NEXUS to see the face on the dongle too.'}
          </p>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`bubble ${m.from}`}>
            {m.from === 'buddy' && (
              <span className="bubble-who">
                {BUDDY_NAME} · {m.emotion}
              </span>
            )}
            {m.text}
          </div>
        ))}
        {busy && <div className="bubble buddy thinking">…</div>}
        <div ref={end} />
      </div>
      <div className="buddy-input">
        <input
          enterKeyHint="send"
          placeholder={`Message ${BUDDY_NAME}`}
          aria-label={`Message ${BUDDY_NAME}`}
          maxLength={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
        />
        <button className="text-button bold" disabled={!draft.trim() || busy} onClick={() => void send()}>
          <Tick />
          Send
        </button>
      </div>
    </div>
  );
}
