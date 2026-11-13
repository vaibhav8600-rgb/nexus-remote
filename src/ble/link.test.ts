// The connection's state machine against a fake NEXUS: what it does when a
// step fails, when the link drops, and when a paste is in the way.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHAR, COMPANION, Ctrl } from '../protocol/packets';
import { NexusLink } from './link';

const NAME: Record<string, string> = Object.fromEntries([
  ...Object.entries(CHAR).map(([k, v]) => [v, k]),
  [COMPANION, 'companion'],
]);

interface Opts {
  failSubscribe?: boolean;
  textFree?: number;
  holdConnect?: boolean;
}

function fakeNexus(opts: Opts = {}) {
  const drops = new Set<() => void>();
  const writes: string[] = [];
  let connected = false;
  let connects = 0;
  let abort: ((e: Error) => void) | undefined;
  const free = opts.textFree ?? 512;
  // version, remote on, no locks, text_free, every feature, USB, batteries
  const status = () => new DataView(Uint8Array.of(1, 1, 0, free & 0xff, free >> 8, 0x7f, 1, 50, 60).buffer);
  const char = (name: string) => ({
    readValue: async () => status(),
    startNotifications: async () => {
      if (opts.failSubscribe) throw new Error('no notifications');
    },
    addEventListener: () => undefined,
    writeValueWithResponse: async () => void writes.push(name),
    writeValueWithoutResponse: async () => void writes.push(name),
  });
  const server = { getPrimaryService: async () => ({ getCharacteristic: async (u: string) => char(NAME[u]) }) };
  const drop = () => {
    if (!connected) return;
    connected = false;
    for (const f of [...drops]) f();
  };
  const device = {
    id: 'x',
    name: 'NEXUS',
    addEventListener: (_: string, f: () => void) => drops.add(f),
    removeEventListener: (_: string, f: () => void) => drops.delete(f),
    gatt: {
      connect: () => {
        connects++;
        if (opts.holdConnect) return new Promise((_, reject) => (abort = reject));
        connected = true;
        return Promise.resolve(server);
      },
      disconnect: () => {
        abort?.(new Error('aborted'));
        drop();
      },
    },
  };
  return { device, writes, drop, isConnected: () => connected, connects: () => connects };
}

const settle = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

async function connect(n: ReturnType<typeof fakeNexus>) {
  vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => n.device } });
  const link = new NexusLink();
  await link.pick();
  return link;
}

describe('NexusLink', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
    vi.stubGlobal('document', { visibilityState: 'visible' });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('connects', async () => {
    const n = fakeNexus();
    const link = await connect(n);
    expect(link.state).toBe('connected');
    expect(link.status?.remoteOn).toBe(true);
  });

  it('is never idle with the radio still connected', async () => {
    const n = fakeNexus({ failSubscribe: true });
    const link = await connect(n);
    expect(link.state).toBe('idle');
    expect(link.error).toContain('subscribe');
    expect(n.isConnected()).toBe(false);
    // ...and that hang-up is not a drop to recover from.
    await settle();
    expect(link.state).toBe('idle');
    expect(n.connects()).toBe(1);
  });

  it('reconnects once after a drop, and forgets the old status meanwhile', async () => {
    const n = fakeNexus();
    const link = await connect(n);
    let seen: unknown = 'unset'; // the status at the first update after the drop
    const stop = link.subscribe(() => {
      if (seen === 'unset') seen = link.status;
    });
    n.drop();
    await settle();
    stop();
    expect(seen).toBeNull();
    expect(link.state).toBe('connected');
    expect(n.connects()).toBe(2);
  });

  it('shows no error when Disconnect is tapped while connecting', async () => {
    const n = fakeNexus({ holdConnect: true });
    vi.stubGlobal('navigator', { bluetooth: { requestDevice: async () => n.device } });
    const link = new NexusLink();
    const picking = link.pick();
    await settle();
    expect(link.state).toBe('connecting');
    link.disconnect();
    await picking;
    expect(link.state).toBe('idle');
    expect(link.error).toBe('');
  });

  it('sends Control ahead of a paste that is waiting for room', async () => {
    vi.useFakeTimers();
    const n = fakeNexus({ textFree: 0 });
    const link = await connect(n);
    link.typeText('a long paste');
    await settle();
    expect(link.textPending).toBeGreaterThan(0);
    await link.control(Ctrl.keepalive);
    expect(n.writes).toContain('control');
    expect(n.writes).not.toContain('text');
  });

  it('keeps keys in order with text', async () => {
    const n = fakeNexus();
    const link = await connect(n);
    link.typeText('hi');
    const key = link.tap(0, 7, 0x28);
    await key;
    expect(n.writes).toEqual(['text', 'key']);
  });
});
