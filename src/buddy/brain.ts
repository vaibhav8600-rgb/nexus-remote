// Buddy's phone brain (Nexus docs/buddy.md): Gemini, asked straight from this
// phone with the owner's own key, in the voice of persona.json - a copy of
// the Nexus repo's persona/persona.json; keep the two the same. Pure apart
// from ask(), so the prompt and the checks are unit-tested.
import persona from './persona.json';

export const MODEL = 'gemini-3.1-flash-lite';
export const LINE_MAX = 24; // the persona's limit, and what the bubble fits
const HISTORY = 12; // turns Gemini is shown, six each way
const REPLY_MAX = 400;

export interface Answer {
  emotion: string; // lower case, one of persona.emotions
  line: string; // upper case, for the dongle
  reply: string; // sentence case, for the phone
}
export interface Turn {
  role: 'user' | 'model';
  parts: { text: string }[];
}
type Persona = typeof persona;

/** What the dongle's font can draw: ASCII 32-90, upper case, 24 at most. */
export const fold = (text: string) =>
  [...text.toUpperCase()]
    .filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 90)
    .join('')
    .slice(0, LINE_MAX);

export function systemPrompt(p: Persona = persona): string {
  const v = p.voice;
  return [
    `You are ${p.name}, a tiny animated face on ${p.owner || 'the owner'}'s keyboard dongle. Pronoun: ${p.pronoun}.`,
    'Traits:',
    ...p.traits.map((t) => `- ${t}`),
    `Voice: ${v.style}. A line is at most ${v.max_chars} characters, ${v.case} case, ${v.charset}.`,
    'Never:',
    ...p.never.map((n) => `- ${n}`),
    'Reply only as JSON matching the schema: "emotion" is how the face looks, "line" goes on the dongle, "reply" is what you say on a screen - when the owner talks to you, a real answer in normal sentence case, at most 200 characters.',
  ].join('\n');
}

const partOfDay = (h: number) => (h < 5 || h >= 23 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening');

/** The owner's words as Gemini is told them, with the time of day. */
export const userTurn = (said: string, now = new Date()): Turn => ({
  role: 'user',
  parts: [
    { text: `Why: the owner is talking to you; answer them.\nIt is ${partOfDay(now.getHours())}.\nThe owner says: ${said}` },
  ],
});

export function requestBody(history: Turn[], said: string, now = new Date()) {
  return {
    systemInstruction: { parts: [{ text: systemPrompt() }] },
    contents: [...history.slice(-HISTORY), userTurn(said, now)],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          emotion: { type: 'STRING', enum: persona.emotions.map((e) => e.toUpperCase()) },
          line: { type: 'STRING' },
          reply: { type: 'STRING' },
        },
        required: ['emotion', 'line', 'reply'],
      },
      temperature: 1.0,
      maxOutputTokens: 400,
    },
  };
}

/** An answer from a generateContent response, or null for anything the
 *  dongle should not be sent: bad JSON, an emotion it does not have, a line
 *  too long or with characters its font cannot draw. */
export function parseReply(raw: unknown): Answer | null {
  try {
    const text = (raw as { candidates: { content: { parts: { text: string }[] } }[] }).candidates[0].content.parts[0]
      .text;
    const obj = JSON.parse(text);
    const emotion = String(obj.emotion).toLowerCase();
    const line = String(obj.line).trim();
    const reply = String(obj.reply ?? '').trim() || line;
    if (!persona.emotions.includes(emotion)) return null;
    if (!line || line.length > LINE_MAX || fold(line) !== line.toUpperCase()) return null;
    return { emotion, line: line.toUpperCase(), reply: reply.slice(0, REPLY_MAX) };
  } catch {
    return null;
  }
}

/** The history with one exchange added, as Gemini's own turns, capped. */
export function remember(history: Turn[], said: string, a: Answer): Turn[] {
  const answer = JSON.stringify({ emotion: a.emotion.toUpperCase(), line: a.line, reply: a.reply });
  return [...history, userTurn(said), { role: 'model' as const, parts: [{ text: answer }] }].slice(-HISTORY);
}

/** The dongle's clock lines for @p now: T seconds since midnight, D days since 1970. */
export function clockLines(now = new Date()): string {
  const t = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  const d = Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  return `T ${t}\nD ${d}\n`;
}

/** Lines for the Companion characteristic, in the host link's protocol. */
export const faceLines = (a: Answer) => `E ${a.emotion.toUpperCase()}\nS ${a.line}\n`;

export const BUDDY_NAME = persona.name;

export interface Command {
  reply: string;
  steps: string[][]; // host-link lines, a step about two seconds apart
}

/** A face ("show me a sad face", "smile") or a trick ("high five") with only
 *  filler words around it, acted out from persona.json without Gemini. Null
 *  for a real conversation: "why are you sad" says more than a face. */
export function command(text: string, p = persona): Command | null {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9' ]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  const filler = new Set([...p.commands.filler, p.name.toLowerCase()]);
  const only = (w: string) =>
    t.includes(` ${w} `) &&
    t
      .replace(` ${w} `, ' ')
      .trim()
      .split(' ')
      .every((x) => !x || filler.has(x));
  for (const a of p.commands.actions) if (a.words.some(only)) return { reply: a.reply, steps: a.steps };
  for (const f of p.commands.faces)
    if (f.words.some(only))
      return { reply: `(${p.name} makes a ${f.emotion} face)`, steps: [[`E ${f.emotion.toUpperCase()}`, `S ${f.line}`]] };
  return null;
}

/** One generateContent call. Throws an Error whose message is fit to show. */
async function post(key: string, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('No internet - Gemini could not be reached.');
  }
  if (res.status === 429) throw new Error('Out of Gemini quota for now. Try again in a few minutes.');
  if (res.status === 400 || res.status === 403) throw new Error('Gemini refused the key. Check it in Settings → Buddy.');
  if (!res.ok) throw new Error(`Gemini answered HTTP ${res.status}.`);
  return res.json().catch(() => null);
}

/** Ask Gemini. Throws an Error whose message is fit to show. */
export async function ask(key: string, history: Turn[], said: string): Promise<Answer> {
  const a = parseReply(await post(key, requestBody(history, said)));
  if (!a) throw new Error('Gemini’s answer did not fit the dongle. Ask again?');
  return a;
}

/** Base64 of bytes, in slices: one String.fromCharCode over a whole clip
 *  overflows the call stack. */
export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** What was said in a WAV clip, word for word; '' for no speech. */
export async function transcribe(key: string, clip: Uint8Array): Promise<string> {
  const raw = await post(key, {
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: 'audio/wav', data: base64(clip) } },
          {
            text: 'Transcribe exactly what is said, in the language spoken. Reply with the words only - no quotes, no notes. If nothing is said, reply with nothing.',
          },
        ],
      },
    ],
    generationConfig: { temperature: 0, maxOutputTokens: 200 },
  });
  const r = raw as { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null;
  return (r?.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim();
}
