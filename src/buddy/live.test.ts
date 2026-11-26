import { describe, expect, it } from 'vitest';
import { systemPrompt } from './brain';
import {
  LIVE_CHAIN,
  LIVE_MODEL,
  MOUTH_THRESHOLDS,
  classify,
  faceFor,
  isQuota,
  level,
  mayLook,
  pcmBase64,
  pcmFromBase64,
  setupMessage,
  sky,
} from './live';
import persona from './persona.json';

/** 50 ms of a 220 Hz sine at 24 kHz, peak @p amp. */
const sine = (amp: number) => Int16Array.from({ length: 1200 }, (_, i) => Math.round(amp * Math.sin((2 * Math.PI * 220 * i) / 24000)));

describe('Talk: live voice', () => {
  it('maps a slice to a mouth 0-4 by its RMS', () => {
    expect(MOUTH_THRESHOLDS).toEqual([400, 1500, 3000, 5000]);
    expect(level(new Int16Array(1200))).toBe(0);
    expect(level(sine(1000))).toBe(1); // RMS ~707
    expect(level(sine(3000))).toBe(2); // ~2121
    expect(level(sine(5000))).toBe(3); // ~3536
    expect(level(sine(12000))).toBe(4); // ~8485
    expect(level(new Int16Array(0))).toBe(0);
    // A part of the buffer only: loud first half, silent second.
    const half = Int16Array.from({ length: 200 }, (_, i) => (i < 100 ? 8000 : 0));
    expect([level(half, 0, 100), level(half, 100, 200)]).toEqual([4, 0]);
  });

  it('encodes float samples as 16-bit little-endian PCM in base64', () => {
    const b64 = pcmBase64(Float32Array.of(0, 1, -1, 0.5, 2));
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(bytes).toHaveLength(10);
    const v = new DataView(bytes.buffer);
    expect([0, 2, 4, 6, 8].map((at) => v.getInt16(at, true))).toEqual([0, 32767, -32767, 16383, 32767]);
    expect(Array.from(pcmFromBase64(b64))).toEqual([0, 32767, -32767, 16383, 32767]);
  });

  it('sets up Gemini Live with the persona and a voice, and no set_face or search', () => {
    const m = setupMessage();
    expect(m.setup.model).toBe(`models/${LIVE_MODEL}`);
    expect(m.setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(m.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Achernar');
    const names = m.setup.tools[0].functionDeclarations.map((f) => f.name);
    // set_face cost every reply a round trip; Google Search makes the free
    // tier refuse 3.8 and 3.1 Live at setup.
    expect(names).toEqual(['get_weather', 'remember', 'forget', 'look']);
    expect(JSON.stringify(m)).not.toContain('googleSearch');
    for (const f of m.setup.tools[0].functionDeclarations) expect(f.behavior).toBe('BLOCKING');
    expect(m.setup.inputAudioTranscription).toEqual({});
    expect(m.setup.outputAudioTranscription).toEqual({});
    expect(m.setup.sessionResumption).toEqual({});
    expect(m.setup.contextWindowCompression.slidingWindow).toEqual({});
    const text = m.setup.systemInstruction.parts[0].text;
    expect(text.startsWith(systemPrompt(persona, true))).toBe(true);
    expect(text).not.toContain('set_face');
    expect(text).toContain("never say you can't");
    expect(text).not.toContain('JSON');
    expect(text).toContain(persona.voice.spoken);
    expect(text).toContain('Pronoun: she');
    for (const t of persona.traits) expect(text).toContain(t);
    expect(setupMessage('other-model', 'Kore').setup.model).toBe('models/other-model');
  });

  it('resumes with a handle, or carries the conversation to another model', () => {
    expect(setupMessage(LIVE_MODEL, 'Kore', { handle: 'h1' }).setup.sessionResumption).toEqual({ handle: 'h1' });
    const text = setupMessage(LIVE_CHAIN[1], 'Kore', { recent: ['Owner: hi', 'NIKU: hello!'] }).setup.systemInstruction
      .parts[0].text;
    expect(text).toContain('do not greet again');
    expect(text).toContain('Owner: hi');
  });

  it('walks 3.8, then 3.1 Flash, then 2.5 native audio', () => {
    expect(LIVE_CHAIN).toEqual([LIVE_MODEL, 'gemini-3.1-flash-live-preview', 'gemini-2.5-flash-native-audio-preview-12-2025']);
  });

  it('reads the face from the words: the last feeling shown, none for facts', () => {
    expect(faceFor('Haha, so fun!')).toBe('HAPPY');
    expect(faceFor('Oh no, I am sorry.')).toBe('SAD');
    expect(faceFor('Sorry... haha, kidding!')).toBe('HAPPY');
    expect(faceFor('Grrr! So mad!')).toBe('ANGRY');
    expect(faceFor('Your battery is at 80 percent.')).toBeNull();
  });

  it('tells a close apart: quota, refused, busy, or a drop to retry', () => {
    expect(classify('You exceeded your current quota')).toBe('quota');
    expect(classify('models/x is not found for API version v1beta')).toBe('refused');
    expect(classify('The service is currently unavailable')).toBe('busy');
    expect(classify('Failed to generate content')).toBe('drop');
    expect(classify('PolicyViolation: session is already connected to an existing client')).toBe('drop');
  });

  it('reads weather codes, and looks only when asked to', () => {
    expect([0, 2, 63, 95].map(sky)).toEqual(['clear', 'partly cloudy', 'rain', 'thunderstorms']);
    expect(mayLook('Can you look at this?')).toBe(true);
    expect(mayLook('What am I holding?')).toBe(true);
    expect(mayLook('How are you?')).toBe(false);
  });

  it('knows a quota close from any other', () => {
    expect(isQuota('Resource has been exhausted (e.g. check quota).')).toBe(true);
    expect(isQuota('API key not valid. Please pass a valid API key.')).toBe(false);
  });
});
