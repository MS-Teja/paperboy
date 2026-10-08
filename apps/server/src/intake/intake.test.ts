import { RingClient } from 'ring-partner-kit';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/client.ts';
import { devices, events } from '../db/schema.ts';
import { ensureHome, pollAllDevices, syncDevices } from './intake.ts';

const DEVICE = 'ring-dev-1';
const historyEvent = (id: string, type: string, start: number) => ({
  type: 'history-events',
  id,
  attributes: { event_type: type, start, end: start + 30_000 },
  relationships: { cv_detections: { data: [] }, source: { data: { type: 'devices', id: DEVICE } } },
});

/** A Ring client whose fetch serves the device list and a mutable history. */
function fakeRing(history: ReturnType<typeof historyEvent>[], calls: { status: number }[] = []) {
  const fetch = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const next = calls.shift();
    if (next) return new Response('{}', { status: next.status, headers: { 'retry-after': '0' } });
    if (url.pathname === '/v1/devices') {
      return Response.json({ data: [{ type: 'devices', id: DEVICE, attributes: { name: 'Front door' } }] });
    }
    return Response.json({ data: [...history].sort((a, b) => b.attributes.start - a.attributes.start) });
  }) as typeof globalThis.fetch;
  return new RingClient({ accessToken: 't', fetch, sleep: async () => {} });
}

describe('intake', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    ensureHome(db, { id: 'demo', name: 'Demo home' });
  });

  it('registers devices once and keeps their names current', async () => {
    const ring = fakeRing([]);
    expect(await syncDevices(db, ring, 'demo')).toBe(1);
    await syncDevices(db, ring, 'demo');
    expect(db.select().from(devices).all()).toMatchObject([{ ringDeviceId: DEVICE, name: 'Front door', homeId: 'demo' }]);
  });

  it('fills events from history and de-duplicates across overlapping polls', async () => {
    const history = [historyEvent('a', 'motion', 1_000_000), historyEvent('b', 'on_demand', 1_060_000)];
    const ring = fakeRing(history);
    await syncDevices(db, ring, 'demo');

    expect(await pollAllDevices(db, ring)).toMatchObject([{ fetched: 2, inserted: 2, duplicate: 0 }]);

    history.push(historyEvent('c', 'ding', 1_120_000));
    expect(await pollAllDevices(db, ring)).toMatchObject([{ fetched: 3, inserted: 1, duplicate: 2 }]);

    const rows = db.select().from(events).all();
    expect(rows.map((r) => [r.ringEventId, r.type, r.source])).toEqual([
      ['a', 'motion_detected', 'history'],
      ['b', 'on_demand', 'history'],
      ['c', 'button_press', 'history'],
    ]);
    expect(rows[0]?.occurredAt.getTime()).toBe(1_000_000);
    expect((rows[0]?.raw as { id: string }).id).toBe('a');
  });

  it('rides out a 429 from Ring and still stores the events', async () => {
    await syncDevices(db, fakeRing([]), 'demo');
    const throttled = fakeRing([historyEvent('a', 'motion', 1_000_000)], [{ status: 429 }, { status: 429 }]);

    expect(await pollAllDevices(db, throttled)).toMatchObject([{ inserted: 1 }]);
  });
});
