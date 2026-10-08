import { describe, expect, it } from 'vitest';
import { scrub } from './scrub.ts';

const DEVICE = 'ava1.ring.device.ABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOP';
const STATUS = 'ava1.ring.device.status.ZYXWVUTSRQPONMLKJIHGFEDCBA765432ZYXWVUTS';

describe('scrub', () => {
  it('redacts secret-named keys and JWTs', () => {
    expect(scrub({ access_token: 'abc', nested: { value: 'eyJhbGciOi.eyJzdWIi.c2ln' } })).toEqual({
      access_token: '<redacted>',
      nested: { value: '<redacted>' },
    });
  });

  it('drops query strings from URLs', () => {
    expect(scrub({ location: 'https://download.example/v1/download?security_token=sig&X-Amz-Date=1' })).toEqual({
      location: 'https://download.example/v1/download?<redacted>',
    });
  });

  it('replaces Ring IDs with stable placeholders, keeping the kind and cross-references', () => {
    const out = scrub({
      id: DEVICE,
      status: { id: STATUS },
      related: `/v1/devices/${DEVICE}/status`,
      again: DEVICE,
    }) as Record<string, any>;

    expect(out.id).toMatch(/^ava1\.ring\.device\.fixture-[0-9a-f]{12}$/);
    expect(out.status.id).toMatch(/^ava1\.ring\.device\.status\.fixture-[0-9a-f]{12}$/);
    expect(out.related).toBe(`/v1/devices/${out.id}/status`);
    expect(out.again).toBe(out.id);
    expect(JSON.stringify(out)).not.toContain('ABCDEFGHIJKL');
  });

  it('is idempotent', () => {
    const once = scrub({ id: DEVICE, url: 'https://x.example/a?b=c' });
    expect(scrub(once)).toEqual(once);
  });

  it('leaves ordinary values alone', () => {
    const value = { name: 'Playground Device', online: true, zones: [{ x: 0.5 }], country: 'US' };
    expect(scrub(value)).toEqual(value);
  });
});
