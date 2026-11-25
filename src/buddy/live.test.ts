import { describe, expect, it } from 'vitest';
import { systemPrompt } from './brain';
import { LIVE_MODEL, MOUTH_THRESHOLDS, isQuota, level, pcmBase64, pcmFromBase64, setupMessage } from './live';
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

  it('sets up Gemini Live with the persona, a voice, and set_face', () => {
    const m = setupMessage();
    expect(m.setup.model).toBe(`models/${LIVE_MODEL}`);
    expect(m.setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(m.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Achernar');
    const fn = m.setup.tools[0].functionDeclarations[0];
    expect(fn.name).toBe('set_face');
    expect(fn.behavior).toBe('BLOCKING');
    expect(fn.parameters.required).toEqual(['emotion']);
    expect(fn.parameters.properties.emotion.enum).toEqual(persona.emotions.map((e) => e.toUpperCase()));
    expect(m.setup.inputAudioTranscription).toEqual({});
    expect(m.setup.outputAudioTranscription).toEqual({});
    const text = m.setup.systemInstruction.parts[0].text;
    expect(text).toBe(systemPrompt(persona, true));
    expect(text).toContain('set_face');
    expect(text).not.toContain('JSON');
    expect(text).toContain(persona.voice.spoken);
    expect(text).toContain('Pronoun: she');
    for (const t of persona.traits) expect(text).toContain(t);
    expect(setupMessage('other-model', 'Kore').setup.model).toBe('models/other-model');
  });

  it('knows a quota close from any other', () => {
    expect(isQuota('Resource has been exhausted (e.g. check quota).')).toBe(true);
    expect(isQuota('API key not valid. Please pass a valid API key.')).toBe(false);
  });
});
