import { describe, expect, it } from 'vitest';
import { RingClient, pollDeviceHistory } from './index.ts';

const event = (id: string, type: string, start: number) => ({
  type: 'history-events',
  id,
  attributes: { event_type: type, start, end: start + 30_000 },
  relationships: { cv_detections: { data: [] }, source: { data: { type: 'devices', id: 'dev' } } },
});

function clientWithPages(pages: unknown[]) {
  const requested: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    requested.push(String(input));
    const page = pages.shift() ?? { data: [] };
    return new Response(JSON.stringify(page), { status: 200 });
  }) as typeof globalThis.fetch;
  return { client: new RingClient({ accessToken: 't', fetch }), requested };
}

describe('pollDeviceHistory', () => {
  it('maps history types to the webhook vocabulary and returns oldest first', async () => {
    const { client } = clientWithPages([
      { data: [event('c', 'on_demand', 3000), event('b', 'ding', 2000), event('a', 'motion', 1000)] },
    ]);

    const events = await pollDeviceHistory(client, 'dev');

    expect(events.map((e) => [e.id, e.type])).toEqual([
      ['a', 'motion_detected'],
      ['b', 'button_press'],
      ['c', 'on_demand'],
    ]);
    expect(events[0]).toMatchObject({ deviceId: 'dev', subType: null, occurredAt: 1000, via: 'history' });
  });

  it('stops paging once events are older than since minus the overlap', async () => {
    const { client, requested } = clientWithPages([
      { data: [event('new', 'motion', 100_000), event('edge', 'motion', 95_000)], links: { next: '/x?page[key]=k1' } },
      { data: [event('old', 'motion', 10_000)], links: { next: '/x?page[key]=k2' } },
      { data: [event('never-read', 'motion', 1)] },
    ]);

    const events = await pollDeviceHistory(client, 'dev', { since: 100_000, overlapMs: 5_000 });

    expect(events.map((e) => e.id)).toEqual(['edge', 'new']);
    expect(requested).toHaveLength(2);
  });

  it('caps the number of events read in one poll', async () => {
    const { client } = clientWithPages([{ data: [event('3', 'motion', 3), event('2', 'motion', 2), event('1', 'motion', 1)] }]);
    expect((await pollDeviceHistory(client, 'dev', { maxEvents: 2 })).map((e) => e.id)).toEqual(['2', '3']);
  });
});
