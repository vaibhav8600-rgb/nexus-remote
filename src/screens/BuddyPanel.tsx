import { useEffect, useRef, useState } from 'react';
import { link } from '../ble/link';
import { BUDDY_NAME, ask, clockLines, command, faceLines, remember, transcribe, type Turn } from '../buddy/brain';
import { LIVE_FALLBACK, LiveTalk, isQuota, type LiveState } from '../buddy/live';
import { Mic } from '../buddy/mic';
import { MicIcon, WaveformIcon } from '../icons';
import { IOS, haptic, updateSettings, useSettings } from '../settings';
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
let asking = false; // a request is out: reopening the tab must not allow a second
let trick: ReturnType<typeof setTimeout> | undefined;

/** Shorter than this is a tap (listen until the next tap), longer a hold. */
const TAP_MS = 400;
/** Talking stops by itself after this. */
const TALK_MAX_MS = 30000;

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
  const [busy, setBusyState] = useState(asking);
  const setBusy = (b: boolean) => {
    asking = b;
    setBusyState(b);
  };
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

  // Talk, two ways on one button. Hold it and speak, and letting go sends;
  // or tap it, speak, and tap again to send. Either way Gemini writes down
  // what was said and it goes through send() like anything typed.
  const [listening, setListening] = useState(false);
  const [tapped, setTapped] = useState(false); // listening until the next tap
  const mic = useRef(new Mic());
  const held = useRef(false); // the button is down
  const latched = useRef(false); // tapped: stays on after the finger lifts
  const starting = useRef(false); // the mic is still opening
  const pressedAt = useRef(0);
  const cap = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Leaving the tab while listening turns the mic off and throws the clip
  // away: nothing is recorded or sent once the panel is gone.
  useEffect(() => {
    const m = mic.current;
    return () => {
      clearTimeout(cap.current);
      held.current = latched.current = false;
      void m.stop();
    };
  }, []);

  const talk = async () => {
    if (latched.current) {
      // The second tap. While the mic is still opening (a permission
      // prompt, a slow first start), talk() below finishes once it is open.
      if (starting.current) latched.current = false;
      else void finish();
      return;
    }
    if (busy || held.current || starting.current) return;
    haptic();
    held.current = true;
    starting.current = true;
    pressedAt.current = Date.now();
    setListening(true);
    if (faceUp()) void link.buddy('B 1\nE LISTENING\n').catch(() => undefined);
    let recording = false;
    let refused = false;
    try {
      recording = await mic.current.start();
    } catch {
      refused = true;
    }
    if (!recording) {
      // Refused, or stopped while it was opening (the tab closed): only the
      // first is something to tell the user.
      held.current = latched.current = starting.current = false;
      setListening(false);
      setTapped(false);
      if (refused) {
        add({ from: 'note', text: 'The microphone was not allowed. Use the keyboard’s microphone instead.' });
      }
      return;
    }
    starting.current = false;
    // A forgotten tap must not leave the mic on.
    cap.current = setTimeout(() => void finish(), TALK_MAX_MS);
    // Held and let go while the mic was opening (the permission prompt).
    if (!held.current && !latched.current) void finish();
  };

  /** The finger lifted - up, cancelled or slid off, whichever comes first. */
  const release = () => {
    if (!held.current) return;
    held.current = false;
    if (Date.now() - pressedAt.current < TAP_MS) {
      latched.current = true; // a tap: keep listening
      setTapped(true);
      return;
    }
    if (!starting.current) void finish();
  };

  const finish = async () => {
    if (!listening && !latched.current && !held.current && !starting.current) return;
    clearTimeout(cap.current);
    held.current = latched.current = false;
    setListening(false);
    setTapped(false);
    const clip = await mic.current.stop();
    if (!clip) {
      if (faceUp()) void link.buddy('E NEUTRAL\n').catch(() => undefined);
      return;
    }
    setBusy(true);
    try {
      const said = await transcribe(s.geminiKey, clip);
      setBusy(false);
      if (said) await send(said);
      else add({ from: 'note', text: 'I didn’t catch that. Hold the button, or tap it, while you talk.' });
    } catch (e) {
      add({ from: 'note', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Talk: a live spoken conversation (buddy/live.ts). Tap to start, tap to
  // end. Leaving the tab or the app ends it too: nothing listens once the
  // panel is gone.
  const [live, setLive] = useState<LiveState | 'off'>('off');
  const talkRef = useRef<LiveTalk>(undefined);
  useEffect(() => {
    const hidden = () => document.visibilityState === 'hidden' && talkRef.current?.stop();
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      talkRef.current?.stop();
    };
  }, []);

  const toggleTalk = () => {
    haptic();
    if (talkRef.current) {
      talkRef.current.stop();
      return;
    }
    const t = new LiveTalk(
      (lines) => {
        if (faceUp()) void link.buddy(lines).catch(() => undefined);
      },
      {
        state: setLive,
        turn: (you, said, emotion) => {
          if (you) add({ from: 'you', text: you });
          if (said) add({ from: 'buddy', text: said, emotion });
        },
        end: (why) => {
          if (talkRef.current === t) talkRef.current = undefined;
          setLive('off');
          if (!why) return;
          add({ from: 'note', text: why });
          if (isQuota(why) && s.liveModel !== LIVE_FALLBACK)
            add({ from: 'note', text: 'Out of voice quota. Settings → Buddy → Voice Model → 2.5 Flash has much more.' });
        },
      },
    );
    talkRef.current = t;
    void t.start(s.geminiKey, s.liveModel);
  };

  const send = async (text = draft) => {
    const said = text.trim();
    if (!said) return;
    haptic();
    if (text === draft) setDraft('');
    add({ from: 'you', text: said });
    // Talking: into the spoken conversation, answered out loud in the same
    // context, faces and tricks included (Gemini picks the face).
    if (talkRef.current) {
      if (!talkRef.current.say(said.slice(0, 500)))
        add({ from: 'note', text: 'Still connecting - send it again in a moment.' });
      return;
    }
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
      {Mic.supported() && typeof WebSocket !== 'undefined' && (
        <div className="buddy-talk-row">
          <button
            className={`buddy-talk${live !== 'off' ? ' on' : ''}`}
            aria-pressed={live !== 'off'}
            disabled={listening || busy}
            onClick={toggleTalk}
          >
            <Tick />
            <WaveformIcon />
            {live === 'off' ? 'Talk' : 'End'}
          </button>
          <span className="buddy-talk-state" aria-live="polite">
            {live === 'off'
              ? `A live conversation, out loud.${IOS ? ' Silent switch off to hear it.' : ''}`
              : live === 'connecting'
                ? 'Connecting…'
                : live === 'speaking'
                  ? `${BUDDY_NAME} is talking. Speak to cut in.`
                  : 'Listening…'}
          </span>
        </div>
      )}
      <div className="buddy-input">
        {Mic.supported() && (
          <button
            className={`buddy-mic${listening ? ' on' : ''}`}
            aria-label={tapped ? 'Tap to send' : 'Tap or hold to talk'}
            aria-pressed={listening}
            disabled={busy || live !== 'off'}
            onPointerDown={(e) => {
              e.preventDefault(); // no focus, no text selection on a long press
              void talk();
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onPointerLeave={release}
            onContextMenu={(e) => e.preventDefault()}
          >
            <Tick />
            <MicIcon />
          </button>
        )}
        <input
          enterKeyHint="send"
          placeholder={
            tapped
              ? 'Listening… tap the mic to send'
              : listening
                ? 'Listening… let go to send'
                : live !== 'off'
                  ? `Type to ${BUDDY_NAME}, answered out loud`
                  : `Message ${BUDDY_NAME}`
          }
          aria-label={`Message ${BUDDY_NAME}`}
          maxLength={500}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && void send()}
        />
        <button className="text-button bold" disabled={!draft.trim() || busy} onClick={() => void send()}>
          <Tick />
          Send
        </button>
      </div>
    </div>
  );
}
