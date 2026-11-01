import { describe, expect, it } from 'vitest';
import { decodeStatus } from '../protocol/packets';
import { clockLines, command, faceLines, fold, parseReply, remember, requestBody, systemPrompt, type Turn } from './brain';
import persona from './persona.json';

const gemini = (obj: unknown) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

describe('Buddy brain', () => {
  it('builds the prompt from persona.json', () => {
    const p = systemPrompt();
    expect(p).toContain(`You are ${persona.name}`);
    for (const t of persona.traits) expect(p).toContain(t);
    for (const n of persona.never) expect(p).toContain(n);
  });

  it('keeps an answer that fits the dongle', () => {
    expect(parseReply(gemini({ emotion: 'HAPPY', line: 'hi vaibhav!', reply: 'Hi there!' }))).toEqual({
      emotion: 'happy',
      line: 'HI VAIBHAV!',
      reply: 'Hi there!',
    });
    expect(parseReply(gemini({ emotion: 'love', line: 'YAY' }))?.reply).toBe('YAY');
  });

  it('refuses what the dongle cannot show', () => {
    expect(parseReply(gemini({ emotion: 'bored', line: 'HI', reply: 'x' }))).toBeNull();
    expect(parseReply(gemini({ emotion: 'happy', line: 'X'.repeat(25), reply: 'x' }))).toBeNull();
    expect(parseReply(gemini({ emotion: 'happy', line: 'HI ~', reply: 'x' }))).toBeNull();
    expect(parseReply(gemini({ emotion: 'happy', line: '', reply: 'x' }))).toBeNull();
    expect(parseReply({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] })).toBeNull();
    expect(parseReply(null)).toBeNull();
  });

  it('folds to the font', () => {
    expect(fold('héllo ~ world, this is far too long')).toBe('HLLO  WORLD, THIS IS FAR');
  });

  it('remembers six exchanges, and sends them before the new message', () => {
    let h: Turn[] = [];
    for (let i = 0; i < 8; i++) h = remember(h, `m${i}`, { emotion: 'happy', line: 'OK', reply: 'ok' });
    expect(h).toHaveLength(12);
    expect(h[0].parts[0].text).toContain('m2');
    const body = requestBody(h, 'what is my name?');
    expect(body.contents).toHaveLength(13);
    expect(body.contents[12].parts[0].text).toContain('The owner says: what is my name?');
    expect(body.generationConfig.responseSchema.properties.emotion.enum).toContain('NEUTRAL');
  });

  it('speaks the host link protocol', () => {
    expect(faceLines({ emotion: 'sad', line: 'OH NO', reply: '' })).toBe('E SAD\nS OH NO\n');
    expect(clockLines(new Date(2026, 10, 1, 19, 5, 30))).toBe(`T ${19 * 3600 + 5 * 60 + 30}\nD 20758\n`);
  });

  it('acts out faces and tricks without Gemini, and only those', () => {
    expect(command('show me sad face')?.steps).toEqual([['E SAD', 'S SNIFF... SO SAD.']]);
    expect(command('Smile!')?.steps[0][0]).toBe('E HAPPY');
    expect(command('hey niku, give me a high five')?.steps).toHaveLength(3);
    expect(command('sing a song')?.steps[0][0]).toBe('E LISTENING');
    for (const t of ['why are you sad?', 'sing a song about cats', 'who is president of india', 'hi', 'are you happy'])
      expect(command(t)).toBeNull();
  });

  it('has only lines the dongle takes in every command', () => {
    const lines = [
      ...persona.commands.actions.flatMap((a) => a.steps.flat()),
      ...persona.commands.faces.map((f) => `S ${f.line}`),
    ];
    for (const l of lines) {
      if (l.startsWith('S ')) expect(fold(l.slice(2)), l).toBe(l.slice(2));
      else if (l.startsWith('E ')) expect(persona.emotions).toContain(l.slice(2).toLowerCase());
      else expect(l, l).toMatch(/^L -?\d{1,2},-?\d{1,2}$/);
    }
  });

  it('reads the Companion bit from Status', () => {
    const v = new DataView(Uint8Array.of(1, 3, 0, 0, 2, 0x40, 1, 50, 60).buffer);
    expect(decodeStatus(v).features.buddy).toBe(true);
    const old = new DataView(Uint8Array.of(1, 3, 0, 0, 2, 0x3f).buffer);
    expect(decodeStatus(old).features.buddy).toBe(false);
  });
});
