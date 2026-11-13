import { describe, expect, it } from 'vitest';
import { base64 } from './brain';
import { downsample, wav } from './mic';

describe('push-to-talk audio', () => {
  it('writes a 16-bit mono WAV header Gemini can read', () => {
    const b = wav(Float32Array.of(0, 1, -1, 0.5), 16000);
    const v = new DataView(b.buffer);
    const text = (at: number) => String.fromCharCode(...b.subarray(at, at + 4));
    expect([text(0), text(8), text(12), text(36)]).toEqual(['RIFF', 'WAVE', 'fmt ', 'data']);
    expect(v.getUint32(4, true)).toBe(36 + 8);
    expect([v.getUint16(20, true), v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([
      1, 1, 16000, 16,
    ]);
    expect(v.getUint32(40, true)).toBe(8);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)]).toEqual([0, 32767, -32767]);
  });

  it('downsamples 48 kHz to 16 kHz by averaging', () => {
    const out = downsample(Float32Array.of(0.3, 0.3, 0.3, -0.6, 0, 0.6), 48000, 16000);
    expect(out).toHaveLength(2);
    expect(out[0]).toBeCloseTo(0.3);
    expect(out[1]).toBeCloseTo(0);
    expect(downsample(Float32Array.of(1, 2), 16000, 16000)).toHaveLength(2);
  });

  it('base64-encodes a clip too big for one String.fromCharCode', () => {
    const big = new Uint8Array(200000).map((_, i) => i & 0xff);
    const back = Uint8Array.from(atob(base64(big)), (c) => c.charCodeAt(0));
    // Not toEqual: its deep comparison of 200,000 elements takes seconds.
    expect(back.length).toBe(big.length);
    expect(back.every((v, i) => v === big[i])).toBe(true);
  });
});
