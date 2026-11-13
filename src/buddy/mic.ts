// Push-to-talk: the phone's mic, held, as 16 kHz mono WAV. WAV because it is
// the one format both sides agree on: MediaRecorder makes webm on Android
// and mp4 on iOS, and neither is on Gemini's list of audio types.
const RATE = 16000;

/** Average @p pcm from @p from Hz down to @p to Hz. */
export function downsample(pcm: Float32Array, from: number, to: number): Float32Array {
  if (from <= to) return pcm;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(pcm.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(pcm.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = a; j < b; j++) sum += pcm[j];
    out[i] = sum / Math.max(1, b - a);
  }
  return out;
}

/** A 16-bit mono WAV file of @p pcm (-1..1) at @p rate. */
export function wav(pcm: Float32Array, rate: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(44 + pcm.length * 2);
  const v = new DataView(b.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // bytes a second
  v.setUint16(32, 2, true); // bytes a frame
  v.setUint16(34, 16, true); // bits
  text(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  pcm.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 0x7fff, true));
  return b;
}

/** Held to talk: start() on press, stop() on release. */
export class Mic {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: ScriptProcessorNode;
  private chunks: Float32Array[] = [];

  static supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /** @return whether it is recording: false if stop() came while it was
   *  still opening. Throws if the microphone was refused. */
  async start(): Promise<boolean> {
    // The context first, inside the tap: iOS only starts audio from a gesture.
    // ponytail: ScriptProcessorNode is deprecated but runs everywhere; an
    // AudioWorklet needs a module file and buys nothing for a few seconds.
    const ctx = (this.ctx = new AudioContext());
    this.chunks = [];
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (e) {
      // Refused: close the context too - a page may only hold a few.
      if (this.ctx === ctx) this.ctx = undefined;
      void ctx.close().catch(() => undefined);
      throw e;
    }
    // stop() came while the permission prompt was up: never leave it on.
    if (this.ctx !== ctx) {
      stream.getTracks().forEach((t) => t.stop());
      return false;
    }
    this.stream = stream;
    const src = ctx.createMediaStreamSource(stream);
    this.node = ctx.createScriptProcessor(4096, 1, 1);
    this.node.onaudioprocess = (e) => this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(this.node);
    this.node.connect(ctx.destination); // silent, but needed for it to run
    return true;
  }

  /** The clip as WAV, or null for a tap too short to be speech. */
  async stop(): Promise<Uint8Array<ArrayBuffer> | null> {
    // Cleared before anything is awaited: a start() still opening checks it
    // the moment its permission prompt resolves, which can be before the
    // context has finished closing.
    const ctx = this.ctx;
    this.ctx = undefined;
    const rate = ctx?.sampleRate ?? 48000;
    this.node?.disconnect();
    this.node = undefined;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = undefined;
    await ctx?.close().catch(() => undefined);
    const pcm = new Float32Array(this.chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of this.chunks) {
      pcm.set(c, at);
      at += c.length;
    }
    this.chunks = [];
    if (pcm.length < rate * 0.4) return null;
    return wav(downsample(pcm, rate, RATE), RATE);
  }
}
