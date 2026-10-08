import Fastify from 'fastify';
import { signWebhookBody } from 'ring-partner-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db/client.ts';
import { devices, events } from '../db/schema.ts';
import { ensureHome } from '../intake/intake.ts';
import { processWebhook, ringWebhookRoutes } from './ring-webhook.ts';

const KEY = 'test-signing-key';

function motionBody(requestId: string, eventId: string, deviceId = 'ring-dev-1') {
  return JSON.stringify({
    meta: { version: '1.1', time: '2026-10-08T01:00:00Z', request_id: requestId, account_id: 'acct' },
    data: {
      id: eventId,
      type: 'motion_detected',
      subType: 'human',
      attributes: { source: deviceId, source_type: 'devices', timestamp: 1791400000000 },
    },
  });
}

describe('POST /webhooks/ring', () => {
  let db: Db;
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    db = openDb(':memory:');
    ensureHome(db, { id: 'demo', name: 'Demo home' });
    db.insert(devices).values({ homeId: 'demo', ringDeviceId: 'ring-dev-1', name: 'Front door' }).run();
    app = Fastify();
    await app.register(ringWebhookRoutes, { db, signingKey: KEY, defer: (task: () => void) => task() });
  });

  afterEach(() => app.close());

  const post = (body: string, signature?: string) =>
    app.inject({
      method: 'POST',
      url: '/webhooks/ring',
      headers: { 'content-type': 'application/json', ...(signature ? { 'x-signature': signature } : {}) },
      payload: body,
    });

  it('accepts a correctly signed delivery and stores the event with its subtype', async () => {
    const body = motionBody('req-1', 'evt-1');
    const res = await post(body, signWebhookBody(body, KEY));

    expect(res.statusCode).toBe(200);
    const rows = db.select().from(events).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ringEventId: 'evt-1', type: 'motion_detected', subType: 'human', source: 'webhook' });
  });

  it('rejects a missing or wrong signature and stores nothing', async () => {
    const body = motionBody('req-2', 'evt-2');
    expect((await post(body)).statusCode).toBe(401);
    expect((await post(body, signWebhookBody(body, 'wrong-key'))).statusCode).toBe(401);
    expect(db.select().from(events).all()).toHaveLength(0);
  });

  it('rejects a body changed after signing', async () => {
    const body = motionBody('req-3', 'evt-3');
    const res = await post(body.replace('human', 'vehicle'), signWebhookBody(body, KEY));
    expect(res.statusCode).toBe(401);
  });

  it('verifies whitespace-sensitive raw bytes, not re-serialised JSON', async () => {
    const body = JSON.stringify(JSON.parse(motionBody('req-4', 'evt-4')), null, 2);
    expect((await post(body, signWebhookBody(body, KEY))).statusCode).toBe(200);
  });
});

describe('processWebhook', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
    ensureHome(db, { id: 'demo', name: 'Demo home' });
    db.insert(devices).values({ homeId: 'demo', ringDeviceId: 'ring-dev-1', name: 'Front door' }).run();
  });

  it('processes a redelivered request_id once', () => {
    const body = Buffer.from(motionBody('req-1', 'evt-1'));
    expect(processWebhook(db, body)).toBe('stored');
    expect(processWebhook(db, body)).toBe('duplicate_delivery');
    expect(db.select().from(events).all()).toHaveLength(1);
  });

  it('stores the same event once even under a new request_id', () => {
    expect(processWebhook(db, Buffer.from(motionBody('req-1', 'evt-1')))).toBe('stored');
    expect(processWebhook(db, Buffer.from(motionBody('req-2', 'evt-1')))).toBe('duplicate_event');
  });

  it('ignores devices that belong to no home, and malformed payloads', () => {
    expect(processWebhook(db, Buffer.from(motionBody('req-5', 'evt-5', 'someone-else')))).toBe('unknown_device');
    expect(processWebhook(db, Buffer.from('not json'))).toBe('invalid_payload');
    expect(processWebhook(db, Buffer.from('{"meta":{}}'))).toBe('invalid_payload');
  });
});
