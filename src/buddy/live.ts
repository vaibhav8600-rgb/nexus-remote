// Talking out loud with Buddy: a live conversation through Gemini Live,
// straight from this phone to Google. The phone's mic streams up, Buddy's
// voice streams back, and the dongle's face listens, follows the feeling in
// Buddy's words and moves its mouth (V 0-4) in time with the speech.
//
// Full duplex: getUserMedia's echo cancellation keeps Buddy from hearing
// itself through the phone speaker, so you can cut in mid-sentence.
//
// The same as the PC's voice window (Nexus tools/nexus-host, docs/buddy.md),
// measured there on the free tier: no set_face round trip each reply, no
// Google Search (it makes 3.8 and 3.1 Live refuse the session), a chain of
// models (BuddyPanel walks it), resumption and a trimmed context.
import { base64, forgetFacts, rememberFact, systemPrompt } from './brain';
import { downsample } from './mic';
import persona from './persona.json';

export const LIVE_MODEL = 'gemini-3.8-live';
/** Far more free-tier quota than LIVE_MODEL. */
export const LIVE_FALLBACK = 'gemini-2.5-flash-native-audio-preview-12-2025';
/** Down this chain when a model is out of quota, busy or gone: each has a
 *  quota of its own. First words measured ~0.5 s, ~0.6-1 s, ~2 s. */
export const LIVE_CHAIN = [LIVE_MODEL, 'gemini-3.1-flash-live-preview', LIVE_FALLBACK];
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
/** Gemini trims the oldest of the conversation past this many tokens, so a
 *  long chat costs no more a turn: the limit that runs out is tokens a minute. */
const TRIGGER_TOKENS = 16000;

/** Calibration knobs. The RMS of a 50 ms slice, in int16 units, at which
 *  the mouth opens one step more; how far it runs behind the audio; how long
 *  a reply starting from silence is held so a late chunk leaves no gap; and
 *  how often the face may change from the words (each change is a chirp). */
export const MOUTH_THRESHOLDS = [400, 1500, 3000, 5000];
export const MOUTH_LAG_S = 0.06;
export const PREBUFFER_S = 0.12;
export const FACE_EVERY_MS = 2500;

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

/** A face from what Buddy is saying: the last feeling its words show, or
 *  null. Asking Gemini for one (set_face) cost every reply a round trip. */
const CUES: [string, RegExp][] = [
  ['LOVE', /\b(love|adore|aww+|sweet of you|hugs?)\b/gi],
  ['HAPPY', /\b(ha(ha)+|he(he)+|yay|great|awesome|nice|glad|happy|wonderful|fun|congrat\w*)\b/gi],
  ['SAD', /\b(sorry|sad|unfortunately|oh no|miss you)\b/gi],
  ['SURPRISED', /\b(wow|whoa|no way|amazing)\b/gi],
  ['THINKING', /\b(hmm+|let me think|let me see|not sure|i wonder)\b/gi],
  ['SLEEPY', /\b(sleepy|tired|yawn\w*|good night|bedtime)\b/gi],
  ['ANGRY', /\b(grr+|annoying|annoyed|angry)\b/gi],
  ['SINGING', /\b(la la|sing\w*)\b/gi],
  ['THUMBSUP', /\b(you got this|well done|good job|thumbs up|nailed it)\b/gi],
  ['HIGHFIVE', /\bhigh.?five\b/gi],
  ['GAMING', /\b(game|gaming)\b/gi],
];

export function faceFor(text: string): string | null {
  let best: string | null = null;
  let at = -1;
  for (const [face, re] of CUES) {
    for (const m of text.matchAll(re)) {
      if (m.index !== undefined && m.index > at) {
        at = m.index;
        best = face;
      }
    }
  }
  return best;
}

/** What a close means for what to try next. */
export type EndKind = 'quota' | 'busy' | 'refused' | 'drop' | 'goaway';
export function classify(reason: string): EndKind {
  const r = reason.toLowerCase();
  if (/\bquota\b|rate.?limit|exhaust|\b429\b/.test(r)) return 'quota';
  // A resume that came back before Google let go of the old connection.
  if (r.includes('already connected')) return 'drop';
  if (/not found|not supported|unsupported|permission|api key|invalid argument|policy/.test(r)) return 'refused';
  if (/unavailable|overload|high demand|\b50\d\b|internal|deadline/.test(r)) return 'busy';
  return 'drop';
}

/** A close reason that means quota or rate limits. Not "rate" alone: that
 *  is inside "generate". */
export const isQuota = (reason: string) => classify(reason) === 'quota';

/** A look only follows an ask to look. */
const LOOK_WORDS = /\b(look|see|camera|watch|show(ing)? you|holding|read (this|that)|what('s| is) (this|that))\b/i;
export const mayLook = (asked: string) => LOOK_WORDS.test(asked);

const TOOLS_HINT = [
  'For the weather, call get_weather and answer from it briefly.',
  'When the owner asks you to remember something, call remember with the fact in a short sentence; forget when they ask you to forget it.',
  "Only when the owner asks you to look at something (through the phone's camera), call look - never on your own.",
  'When you have looked because the owner asked, describe and read what you see plainly.',
].join('\n');

export interface SetupOptions {
  /** 3.8 Live's resumption handle: the very conversation carries on. */
  handle?: string;
  /** The conversation so far, for any other model to carry on from. */
  recent?: string[];
}

/** The first message of a session. */
export function setupMessage(model = LIVE_MODEL, voice = LIVE_VOICE, o: SetupOptions = {}) {
  let text = `${systemPrompt(persona, true)}\n${TOOLS_HINT}`;
  if (o.recent?.length) text += `\n\nThe conversation so far, which carries on now - do not greet again:\n${o.recent.join('\n')}`;
  return {
    setup: {
      model: `models/${model}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        // A look reads small print; pictures go only on request.
        mediaResolution: 'MEDIA_RESOLUTION_HIGH',
      },
      systemInstruction: { parts: [{ text }] },
      tools: [
        {
          functionDeclarations: [
            {
              name: 'get_weather',
              description: "The weather where the owner is: now, and today's and tomorrow's forecast",
              behavior: 'BLOCKING',
            },
            {
              name: 'remember',
              description: 'Remember a fact about the owner from now on, across days',
              behavior: 'BLOCKING',
              parameters: { type: 'OBJECT', properties: { fact: { type: 'STRING' } }, required: ['fact'] },
            },
            {
              name: 'forget',
              description: 'Forget every remembered fact that mentions this ("everything" forgets all)',
              behavior: 'BLOCKING',
              parameters: { type: 'OBJECT', properties: { about: { type: 'STRING' } }, required: ['about'] },
            },
            {
              name: 'look',
              description: "Take one photo with the phone's camera to look at. Only when the owner asks you to look.",
              behavior: 'BLOCKING',
            },
          ],
        },
      ],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption: o.handle ? { handle: o.handle } : {},
      contextWindowCompression: { slidingWindow: {}, triggerTokens: TRIGGER_TOKENS },
    },
  };
}

/** WMO weather codes, as Open-Meteo gives them. */
export function sky(code: number): string {
  if (code === 0) return 'clear';
  if (code <= 2) return 'partly cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'foggy';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain showers';
  if (code === 85 || code === 86) return 'snow showers';
  if (code >= 95) return 'thunderstorms';
  return 'unknown';
}

/** The weather here, from Open-Meteo: free, no key, no Gemini quota. Only
 *  the phone's rough location goes, and only when asked. */
async function weather(): Promise<unknown> {
  const pos = await new Promise<GeolocationPosition>((ok, no) =>
    navigator.geolocation.getCurrentPosition(ok, no, { maximumAge: 600000, timeout: 8000, enableHighAccuracy: false }),
  ).catch(() => null);
  if (!pos) return 'no location - allow location for this page to get the weather';
  const { latitude: lat, longitude: lon } = pos.coords;
  const res = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m' +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=2&timezone=auto',
  );
  const w = (await res.json()) as {
    current: Record<string, number>;
    daily: Record<string, (number | null)[]>;
  };
  const day = (i: number) => ({
    sky: sky(w.daily.weather_code[i] ?? -1),
    high_c: Math.round(w.daily.temperature_2m_max[i] ?? NaN),
    low_c: Math.round(w.daily.temperature_2m_min[i] ?? NaN),
    rain_chance_percent: w.daily.precipitation_probability_max[i],
  });
  return {
    now: sky(w.current.weather_code),
    temperature_c: Math.round(w.current.temperature_2m),
    feels_like_c: Math.round(w.current.apparent_temperature),
    humidity_percent: w.current.relative_humidity_2m,
    wind_kmh: Math.round(w.current.wind_speed_10m),
    today: day(0),
    tomorrow: day(1),
  };
}

/** One photo from the back camera, at most 1280 wide, as JPEG base64. The
 *  camera is on only for this. */
async function photo(): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  try {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = stream;
    await v.play();
    // A moment for the exposure: the very first frame is often dark.
    await new Promise((r) => setTimeout(r, 600));
    const k = Math.min(1, 1280 / v.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * k);
    c.height = Math.round(v.videoHeight * k);
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.7).split(',')[1];
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

export type LiveState = 'connecting' | 'listening' | 'speaking';

export interface LiveEvents {
  state(s: LiveState): void;
  /** What you said, as soon as Buddy starts answering it: a face or trick
   *  asked for plays now (BuddyPanel). */
  heard?(you: string): void;
  /** One exchange, when Buddy has finished (or was cut off). */
  turn(you: string, buddy: string, emotion: string): void;
  /** A note fit to show - with the photo itself when one was shared. */
  note?(text: string, image?: string): void;
  /** The session is over: why (null when you ended it), what kind of end -
   *  undefined on purpose - and 3.8's resumption handle, if it gave one. */
  end(why: string | null, kind?: EndKind, handle?: string): void;
}

interface ToolCall {
  id?: string;
  name?: string;
  args?: { fact?: string; about?: string };
}

interface ServerMsg {
  setupComplete?: unknown;
  goAway?: unknown;
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  serverContent?: {
    interrupted?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    modelTurn?: { parts?: { inlineData?: { data?: string } }[] };
  };
  toolCall?: { functionCalls?: ToolCall[] };
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
  private faceAt = 0;
  private firstAudioAt = 0;
  private holdUntil = 0;
  private spoke = false;
  private talking = false; // Buddy's voice is playing
  private handle?: string;
  private goAwayAt = 0;
  private heardAt = 0;
  private asked = '';
  private askedAt = 0;

  /** @p face sends host-link lines to the dongle (a no-op without one).
   *  @p shared is an AudioContext made inside the tap and kept: iOS only
   *  starts audio from a gesture, and a reconnect (the next model, Google's
   *  routine goAway) comes without one. */
  constructor(
    private face: (lines: string) => void,
    private ev: LiveEvents,
    private shared?: AudioContext,
  ) {}

  async start(key: string, model: string, o: SetupOptions = {}): Promise<void> {
    // The context first, inside the tap: iOS only starts audio from a gesture.
    const ctx = (this.ctx = this.shared ?? new AudioContext());
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
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
    ws.onopen = () => ws.send(JSON.stringify(setupMessage(model, LIVE_VOICE, o)));
    ws.onmessage = (e) => {
      // Text or binary frames, whichever comes: both are UTF-8 JSON.
      const text = typeof e.data === 'string' ? e.data : new TextDecoder().decode(e.data as ArrayBuffer);
      try {
        this.onMessage(JSON.parse(text) as ServerMsg);
      } catch {
        /* one bad message is not worth ending the conversation */
      }
    };
    // A bad key, model or quota comes back as the close reason, and only there.
    ws.onclose = (e) => {
      if (this.over) return this.end(null);
      const why = e.reason || `Gemini closed the session (${e.code}).`;
      this.end(why, classify(e.reason || ''));
    };

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
    this.ask(text);
    this.ws.send(JSON.stringify({ realtimeInput: { text } }));
    return true;
  }

  /** A face or trick is playing: the faces read from the words keep out of
   *  its way until then. */
  holdFaces(ms: number) {
    this.holdUntil = Date.now() + ms;
  }

  /** You ended it. */
  stop() {
    this.end(null);
  }

  private ask(text: string) {
    this.asked = text;
    this.askedAt = Date.now();
  }

  /** Everything off. Safe to call again: a stream that finished opening
   *  after an earlier call is closed by the next. */
  private end(why: string | null, kind?: EndKind) {
    const first = !this.over;
    this.over = true;
    this.ready = false;
    clearInterval(this.timer);
    const ws = this.ws;
    this.ws = undefined;
    // Said goodbye rather than dropped: Google lets go sooner, so a resume
    // straight after is not "already connected".
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000);
    this.node?.disconnect();
    this.node = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    this.hush();
    if (!this.shared) void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
    if (first) {
      this.face('V 0\n');
      this.flush(true);
      this.ev.end(why, kind, this.handle);
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

  private setFace(f: string) {
    this.face(`E ${f}\n`);
    this.emotion = f.toLowerCase();
    this.faceSet = true;
    this.faceAt = Date.now();
  }

  /** The face follows the feeling in Buddy's words, at most every FACE_EVERY_MS. */
  private faceFromWords() {
    if (Date.now() < this.holdUntil) return;
    const f = faceFor(this.said);
    if (!f || !FACES.includes(f) || f.toLowerCase() === this.emotion) return;
    if (this.faceSet && Date.now() - this.faceAt < FACE_EVERY_MS) return;
    this.setFace(f);
  }

  private onMessage(m: ServerMsg) {
    if (m.setupComplete) {
      this.ready = true;
      this.heardAt = Date.now();
      this.face('B 1\n');
      this.ev.state('listening');
    }
    if (m.sessionResumptionUpdate?.resumable && m.sessionResumptionUpdate.newHandle)
      this.handle = m.sessionResumptionUpdate.newHandle;
    const sc = m.serverContent;
    if (sc) {
      if (sc.interrupted) {
        this.hush();
        this.face('V 0\n');
        this.mouth = 0;
        this.flush(true);
        this.faceSet = this.spoke = this.talking = false;
        this.firstAudioAt = 0;
        this.ev.state('listening');
      }
      if (sc.inputTranscription?.text) {
        this.heard += sc.inputTranscription.text;
        this.heardAt = Date.now();
        this.ask(this.heard);
        this.listen();
      }
      if (sc.outputTranscription?.text) {
        this.said += sc.outputTranscription.text;
        this.faceFromWords();
      }
      for (const p of sc.modelTurn?.parts ?? []) {
        const data = p.inlineData?.data;
        if (!data) continue;
        if (!this.spoke) {
          this.firstAudioAt = Date.now();
          // Your turn is over once Buddy answers: a face or trick you asked
          // for plays with the answer, not after it.
          if (this.heard.trim()) this.ev.heard?.(this.heard.trim());
        }
        this.spoke = true;
        this.play(pcmFromBase64(data));
      }
      if (sc.turnComplete) {
        this.flush(false);
        this.listening = this.faceSet = this.spoke = false;
        this.firstAudioAt = 0;
      }
    }
    const calls = m.toolCall?.functionCalls;
    if (calls) void this.tools(calls);
    // Google closes every connection after a while: end it in a pause, and
    // BuddyPanel reconnects at once (3.8 resumes the same conversation).
    if (m.goAway && !this.goAwayAt) this.goAwayAt = Date.now();
  }

  /** Tools only this phone can run, answered when done. */
  private async tools(calls: ToolCall[]) {
    let photoB64: string | null = null;
    const answers = [];
    for (const c of calls) {
      let result: unknown = 'unknown tool';
      try {
        if (c.name === 'get_weather') result = await weather();
        else if (c.name === 'remember') {
          result = rememberFact(c.args?.fact ?? '') ? 'remembered' : 'nothing to remember';
        } else if (c.name === 'forget') result = `forgot ${forgetFacts(c.args?.about ?? '')} things`;
        else if (c.name === 'look') {
          // Gemini deciding to look by itself is refused here.
          if (Date.now() - this.askedAt > 30000 || !mayLook(this.asked)) {
            result = 'not allowed: only when the owner asks you to look';
          } else {
            photoB64 = await photo();
            result = "taking the picture now; it comes next, with the owner's question again";
          }
        }
      } catch (e) {
        result = `unavailable: ${(e as Error).message}`;
      }
      answers.push({ id: c.id, name: c.name, response: { result } });
    }
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ toolResponse: { functionResponses: answers } }));
    // The picture after the tool's answer, then the question again as a turn
    // of its own: measured on 3.8, the only order in which it was looked at.
    if (photoB64) {
      ws.send(JSON.stringify({ realtimeInput: { video: { mimeType: 'image/jpeg', data: photoB64 } } }));
      this.ev.note?.('Shared one photo from the camera with Gemini:', `data:image/jpeg;base64,${photoB64}`);
      await new Promise((r) => setTimeout(r, 600));
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ realtimeInput: { text: `(The photo is in your video input now. ${this.asked})` } }));
    }
  }

  /** A chunk of Buddy's voice, queued straight after the last, with its
   *  mouth shapes on the timeline at the moments they will play. A reply
   *  starting from silence waits PREBUFFER_S, so a late chunk leaves no gap. */
  private play(pcm: Int16Array) {
    const ctx = this.ctx;
    if (!ctx || pcm.length === 0) return;
    const buf = ctx.createBuffer(1, pcm.length, OUT_RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const at = this.next > ctx.currentTime ? this.next : ctx.currentTime + PREBUFFER_S;
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
    const quiet = this.timeline.length === 0 && now >= this.next + MOUTH_LAG_S;
    if (this.talking && quiet) {
      this.talking = false;
      this.ev.state('listening');
    }
    // Speaking with no feeling in the words yet: neutral, after a moment, so
    // a cue in the next words is one chirp, not two.
    if (this.firstAudioAt && !this.faceSet && Date.now() - this.firstAudioAt > 1200) {
      this.faceSet = true;
      this.faceAt = Date.now();
      if (Date.now() >= this.holdUntil) {
        this.face('E NEUTRAL\n');
        this.emotion = 'neutral';
      }
    }
    if (this.goAwayAt && ((quiet && Date.now() - this.heardAt > 1500) || Date.now() - this.goAwayAt > 20000))
      this.end(null, 'goaway');
  }
}
