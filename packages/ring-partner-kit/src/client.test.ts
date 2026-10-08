import { describe, expect, it } from 'vitest';
import { RingApiError, RingClient, retryDelayMs } from './index.ts';

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  }) as typeof fetch;
  return { fn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

function authOf(call: Call | undefined): string | null {
  return new Headers(call?.init?.headers).get('authorization');
}

describe('retryDelayMs', () => {
  it('honours Retry-After in seconds', () => {
    expect(retryDelayMs('3', 0)).toBe(3000);
  });

  it('honours Retry-After as an HTTP date', () => {
    const now = Date.parse('2026-10-08T00:00:00Z');
    expect(retryDelayMs('Thu, 08 Oct 2026 00:00:05 GMT', 0, now)).toBe(5000);
  });

  it('backs off exponentially from one second without Retry-After', () => {
    expect([0, 1, 2, 3].map((a) => retryDelayMs(null, a))).toEqual([1000, 2000, 4000, 8000]);
  });
});

describe('RingClient', () => {
  it('retries a 429 after the Retry-After delay, then succeeds', async () => {
    const { fn, calls } = fakeFetch([
      () => json(429, {}, { 'retry-after': '2' }),
      () => json(200, { data: [] }),
    ]);
    const sleeps: number[] = [];
    const client = new RingClient({ accessToken: 't0k', fetch: fn, sleep: async (ms) => void sleeps.push(ms) });

    const list = await client.listDevices(['status']);

    expect(list.data).toEqual([]);
    expect(sleeps).toEqual([2000]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe('https://api.amazonvision.com/v1/devices?include=status');
    expect(authOf(calls[0])).toBe('Bearer t0k');
  });

  it('turns a 401 into a RingApiError that does not leak the token', async () => {
    const { fn } = fakeFetch([
      () => json(401, { errors: [{ status: '401', code: 'UNAUTHORIZED', detail: 'expired' }] }),
    ]);
    const client = new RingClient({ accessToken: 'secret-token-value', fetch: fn });

    const err = await client.getDeviceStatus('ava1.ring.device.abc').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RingApiError);
    expect((err as RingApiError).isUnauthorized).toBe(true);
    expect((err as RingApiError).code).toBe('UNAUTHORIZED');
    expect(String((err as Error).message)).not.toContain('secret-token-value');
    expect(String((err as Error).message)).not.toContain('ava1.ring.device.abc');
  });

  it('downloads an image in two steps without sending the token to the media URL', async () => {
    const media = 'https://media.api.amazonvision.com/v1/download?security_token=sig';
    const { fn, calls } = fakeFetch([
      () => new Response(null, { status: 303, headers: { location: media } }),
      () =>
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/jpeg', 'x-media-timestamp': '1699457230000', 'x-media-origin': 'snapshot' },
        }),
    ]);
    const client = new RingClient({ accessToken: 't0k', fetch: fn });

    const image = await client.downloadImage('dev', { type: 'latest_in_range', startTimestamp: 1 });

    expect(image.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(image).toMatchObject({ contentType: 'image/jpeg', mediaTimestamp: 1699457230000, mediaOrigin: 'snapshot' });
    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.init?.redirect).toBe('manual');
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ type: 'latest_in_range', start_timestamp: 1 });
    expect(calls[1]?.url).toBe(media);
    expect(authOf(calls[1])).toBeNull();
  });

  it('reports a 416 from the media URL as MEDIA_NOT_FOUND without the pre-signed URL', async () => {
    const { fn } = fakeFetch([
      () => new Response(null, { status: 303, headers: { location: 'https://media.example/x?security_token=sig' } }),
      () => json(416, { errors: [{ code: 'MEDIA_NOT_FOUND', detail: 'No media found in time range' }] }),
    ]);
    const client = new RingClient({ accessToken: 't0k', fetch: fn });

    const err = (await client
      .downloadImage('dev', { type: 'at_timestamp', timestamp: 1 })
      .catch((e: unknown) => e)) as RingApiError;

    expect(err.status).toBe(416);
    expect(err.code).toBe('MEDIA_NOT_FOUND');
    expect(err.message).not.toContain('security_token');
  });

  it('follows the history cursor and stops on an empty page', async () => {
    const event = (id: string) => ({
      type: 'history-events',
      id,
      attributes: { event_type: 'motion', start: 1, end: 2 },
    });
    const { fn, calls } = fakeFetch([
      () => json(200, { data: [event('a'), event('b')], links: { next: '/v1/history/devices/dev/events?page[key]=k1' } }),
      () => json(200, { data: [], links: { next: '/v1/history/devices/dev/events?page[key]=k2' } }),
    ]);
    const client = new RingClient({ accessToken: 't0k', fetch: fn });

    const ids: string[] = [];
    for await (const e of client.iterateHistory('dev', { eventTypes: ['motion.human', 'ding'] })) ids.push(e.id);

    expect(ids).toEqual(['a', 'b']);
    expect(calls).toHaveLength(2);
    const second = new URL(calls[1]!.url);
    expect(second.searchParams.get('page[key]')).toBe('k1');
    expect(second.searchParams.get('event_types')).toBe('motion.human,ding');
  });
});
