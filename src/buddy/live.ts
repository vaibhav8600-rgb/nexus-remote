// Talking out loud with Buddy: a live conversation through Gemini Live,
// straight from this phone to Google. The phone's mic streams up, Buddy's
// voice streams back, and the dongle's face listens, shows an emotion and
// moves its mouth (V 0-4) in time with the speech.
//
// Full duplex: getUserMedia's echo cancellation keeps Buddy from hearing
// itself through the phone speaker, so you can cut in mid-sentence.
import { base64, systemPrompt } from './brain';
import { downsample } from './mic';
import persona from './persona.json';

export const LIVE_MODEL = 'gemini-3.8-live';
/** Far more free-tier quota than LIVE_MODEL; Settings → Buddy switches to it. */
export const LIVE_FALLBACK = 'gemini-2.5-flash-native-audio-preview-12-2025';
/** Soft and calm. Other gentle ones: Vindemiatrix, Sulafat, Despina, Aoede. */
export const LIVE_VOICE = 'Achernar';
// Browsers cannot set a WebSocket's headers, so the key rides in the query
// string - over TLS, from the phone straight to Google. Never logged.
const LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

const MIC_RATE = 16000;
const OUT_RATE = 24000;
const SLICE_S = 0.05; // one mouth shape per 50 ms of speech
const MOUTH_TICK_MS = 80; // at most ~12 V lines a second: it is Bluetooth

/** Calibration knobs. The RMS of a 50 ms slice, in int16 units, at which
 *  the mouth opens one step more; and how far it runs behind the audio. */
export const MOUTH_THRESHOLDS = [400, 1500, 3000, 5000];
export const MOUTH_LAG_S = 0.06;

/** 0-4: how many thresholds the slice's RMS clears. */
export function level(pcm: Int16Array, from = 0, to = pcm.length): number {
  const n = to - from;
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
  const rms = Math.sqrt(sum / n);
  return MOUTH_THRESHOLDS.filter((t) => rms >= t).length;
}

/** Float samples (-1..1) as 16-bit little-endian PCM, base64. */
export function pcmBase64(pcm: Float32Array): string {
  const b = new Uint8Array(pcm.length * 2);
  const v = new DataView(b.buffer);
  pcm.forEach((x, i) => v.setInt16(i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return base64(b);
}

/** base64 16-bit little-endian PCM back to samples. */
export function pcmFromBase64(data: string): Int16Array {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const v = new DataView(bytes.buffer);
  const out = new Int16Array(bytes.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = v.getInt16(i * 2, true);
  return out;
}

const FACES = persona.emotions.map((e) => e.toUpperCase());

/** The first message of a session. */
export function setupMessage(model = LIVE_MODEL, voice = LIVE_VOICE) {
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
      },
      systemInstruction: { parts: [{ text: systemPrompt(persona, true) }] },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'set_face',
              description: 'Show this face on the dongle',
              // Blocking: the model waits for the answer, so the face comes
              // before the words. Left asynchronous, gemini-3.8-live was
              // measured calling it after the whole reply.
              behavior: 'BLOCKING',
              parameters: {
                type: 'OBJECT',
                properties: { emotion: { type: 'STRING', enum: FACES } },
                required: ['emotion'],
              },
            },
          ],
        },
      ],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
  };
}

/** A close reason that means quota or rate limits. */
export const isQuota = (reason: string) => /quota|rate|exhaust|429/i.test(reason);

export type LiveState = 'connecting' | 'listening' | 'speaking';

export interface LiveEvents {
  state(s: LiveState): void;
  /** One exchange, when Buddy has finished (or was cut off). */
  turn(you: string, buddy: string, emotion: string): void;
  /** The session is over: null when you ended it, else why, fit to show. */
  end(why: string | null): void;
}

interface ServerMsg {
  setupComplete?: unknown;
  goAway?: unknown;
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
  };
  toolCall?: { functionCalls?: { id?: string; name?: string; args?: { emotion?: string } }[] };
}

/** One live conversation: start() inside a tap, then stop() or it ends itself. */
export class LiveTalk {
  private ws?: WebSocket;
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();
  private next = 0; // when the queued speech ends, in ctx time
  private timeline: [number, number][] = []; // (ctx time, mouth level)
  private mouth = 0;
  private timer?: ReturnType<typeof setInterval>;
  private ready = false;
  private over = false;
  private heard = '';
  private said = '';
  private emotion = 'neutral';
  private listening = false;
  private faceSet = false;
  private spoke = false;
  private talking = false; // Buddy's voice is playing

  /** @p face sends host-link lines to the dongle (a no-op without one). */
  constructor(
    private face: (lines: string) => void,
    private ev: LiveEvents,
  ) {}

  async start(key: string, model: string): Promise<void> {
    // The context first, inside the tap: iOS only starts audio from a gesture.
    const ctx = (this.ctx = new AudioContext());
    // The silent switch mutes web audio on iOS; a session that records and
    // plays is not muted by it. Only where the Audio Session API exists.
    const session = (navigator as { audioSession?: { type: string } }).audioSession;
    if (session) {
      try {
        session.type = 'play-and-record';
      } catch {
        /* older WebKit: the silent switch still applies */
      }
    }
    this.ev.state('connecting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch {
      return this.end('The microphone was not allowed.');
    }
    if (this.over) return this.end(null); // stopped while the prompt was up

    const ws = (this.ws = new WebSocket(`${LIVE_URL}?key=${encodeURIComponent(key)}`));
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => ws.send(JSON.stringify(setupMessage(model)));
    ws.onmessage = (e) => {
      // Text or binary frames, whichever comes: both are UTF-8 JSON.
      const text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer);
      try {
        this.handle(JSON.parse(text) as ServerMsg);
      } catch {
        /* one bad message is not worth ending the conversation */
      }
    };
    // A bad key, model or quota comes back as the close reason, and only there.
    ws.onclose = (e) =>
      this.end(this.over ? null : e.reason || (e.code === 1000 ? null : `Gemini closed the session (${e.code}).`));

    const src = ctx.createMediaStreamSource(this.stream);
    // ponytail: ScriptProcessorNode is deprecated but runs everywhere; 4096
    // frames at 48 kHz is ~85 ms a chunk, near enough the ~100 ms wanted.
    this.node = ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => {
      if (!this.ready || ws.readyState !== WebSocket.OPEN) return;
      const pcm = downsample(e.inputBuffer.getChannelData(0), ctx.sampleRate, MIC_RATE);
      ws.send(
        JSON.stringify({ realtimeInput: { audio: { mimeType: `audio/pcm;rate=${MIC_RATE}`, data: pcmBase64(pcm) } } }),
      );
    };
    src.connect(this.node);
    this.node.connect(ctx.destination); // silent, but needed for it to run
    this.timer = setInterval(() => this.tick(), MOUTH_TICK_MS);
  }

  /** Something typed, into the same conversation: answered out loud. False
   *  when not connected yet (or any more). */
  say(text: string): boolean {
    if (!this.ready || this.ws?.readyState !== WebSocket.OPEN || !text) return false;
    this.ws.send(JSON.stringify({ realtimeInput: { text } }));
    return true;
  }

  /** You ended it. */
  stop() {
    this.end(null);
  }

  /** Everything off. Safe to call again: a stream that finished opening
   *  after an earlier call is closed by the next. */
  private end(why: string | null) {
    const first = !this.over;
    this.over = true;
    this.ready = false;
    clearInterval(this.timer);
    const ws = this.ws;
    this.ws = undefined;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
    this.node?.disconnect();
    this.node = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.hush();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
    if (first) {
      this.face('V 0\n');
      this.flush(true);
      this.ev.end(why);
    }
  }

  /** Stop all speech now, and close the mouth with it. */
  private hush() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already finished */
      }
    }
    this.sources.clear();
    this.timeline = [];
    this.next = 0;
  }

  /** Hand over what was said this turn. */
  private flush(cut: boolean) {
    if (this.heard.trim() || this.said.trim())
      this.ev.turn(this.heard.trim(), this.said.trim() + (cut && this.said.trim() ? ' —' : ''), this.emotion);
    this.heard = this.said = '';
  }

  private listen() {
    if (this.listening) return;
    this.listening = true;
    this.face('E LISTENING\n');
    this.ev.state('listening');
  }

  private handle(m: ServerMsg) {
    if (m.setupComplete) {
      this.ready = true;
      this.face('B 1\n');
      this.ev.state('listening');
    }
    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) {
        this.hush();
        this.face('V 0\n');
        this.mouth = 0;
        this.flush(true);
        this.faceSet = this.spoke = this.talking = false;
        this.ev.state('listening');
      }
      if (sc.inputTranscription?.text) {
        this.heard += sc.inputTranscription.text;
        this.listen();
      }
      if (sc.outputTranscription?.text) this.said += sc.outputTranscription.text;
      for (const p of sc.modelTurn?.parts ?? []) {
        const data = p.inlineData?.data;
        if (!data) continue;
        if (!this.spoke && !this.faceSet) {
          this.face('E NEUTRAL\n');
          this.emotion = 'neutral';
        }
        this.spoke = true;
        this.play(pcmFromBase64(data));
      }
      if (sc.turnComplete) {
        this.flush(false);
        this.listening = this.faceSet = this.spoke = false;
      }
    }
    const calls = m.toolCall?.functionCalls;
    if (calls) {
      for (const c of calls) {
        const e = String(c.args?.emotion ?? '').toUpperCase();
        // Only a face the dongle has: anything else is dropped.
        if (c.name === 'set_face' && FACES.includes(e)) {
          this.face(`E ${e}\n`);
          this.emotion = e.toLowerCase();
          this.faceSet = true;
        }
      }
      this.ws?.send(
        JSON.stringify({
          toolResponse: {
            functionResponses: calls.map((c) => ({ id: c.id, name: c.name, response: { result: 'ok' } })),
          },
        }),
      );
    }
    if (m.goAway) this.end('Gemini ends a voice conversation after about 15 minutes. Tap Talk to go on.');
  }

  /** A chunk of Buddy's voice, queued straight after the last, with its
   *  mouth shapes on the timeline at the moments they will play. */
  private play(pcm: Int16Array) {
    const ctx = this.ctx;
    if (!ctx || pcm.length === 0) return;
    const buf = ctx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const at = Math.max(ctx.currentTime, this.next);
    src.start(at);
    src.onended = () => this.sources.delete(src);
    this.sources.add(src);
    this.next = at + buf.duration;
    const slice = Math.round(OUT_RATE * SLICE_S);
    for (let i = 0, k = 0; i < pcm.length; i += slice, k++)
      this.timeline.push([at + MOUTH_LAG_S + k * SLICE_S, level(pcm, i, Math.min(pcm.length, i + slice))]);
    if (!this.talking) {
      this.talking = true;
      this.ev.state('speaking');
    }
  }

  /** Move the mouth: on a change only, and never faster than the tick. */
  private tick() {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    let n = -1;
    while (this.timeline.length && this.timeline[0][0] <= now) n = this.timeline.shift()![1];
    if (n < 0) n = this.timeline.length === 0 && now >= this.next + MOUTH_LAG_S ? 0 : this.mouth;
    if (n !== this.mouth) {
      this.mouth = n;
      this.face(`V ${n}\n`);
    }
    if (this.talking && this.timeline.length === 0 && now >= this.next + MOUTH_LAG_S) {
      this.talking = false;
      this.ev.state('listening');
    }
  }
}
