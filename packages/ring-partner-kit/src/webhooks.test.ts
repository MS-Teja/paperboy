import { describe, expect, it } from 'vitest';
import { fromWebhook, signWebhookBody, verifyWebhookSignature, WebhookPayloadSchema } from './index.ts';

// Vectors computed independently with:
//   printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$KEY" -hex
const BODY = '{"meta":{"request_id":"req-1"},"data":{"id":"e1","type":"motion_detected"}}';
const KEY = 'test-signing-key';
const SIGNATURE = 'sha256=0376e35966771b03f56ed8908820a3ca8d8a9ed2d9fa94fabaea05ae7b8b579d';

describe('webhook signatures', () => {
  it('matches the openssl test vector', () => {
    expect(signWebhookBody(BODY, KEY)).toBe(SIGNATURE);
  });

  it('uses the key as UTF-8 bytes, not Base64', () => {
    expect(signWebhookBody('{"a":1}', 'k3y-with-ünïcode')).toBe(
      'sha256=ae26ec4a407fce8c93a2ff71e521f3dde662fee6adc73e6c291d3f6c732f1a0d',
    );
  });

  it('accepts a valid signature over raw bytes', () => {
    expect(verifyWebhookSignature(Buffer.from(BODY, 'utf8'), SIGNATURE, KEY)).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(BODY.replace('motion_detected', 'button_press'), SIGNATURE, KEY)).toBe(false);
  });

  it('rejects re-serialised JSON, which changes the bytes', () => {
    const reserialised = JSON.stringify(JSON.parse(BODY), null, 1);
    expect(verifyWebhookSignature(reserialised, SIGNATURE, KEY)).toBe(false);
  });

  it('rejects a wrong key, a missing header, a bare hex digest and an empty key', () => {
    expect(verifyWebhookSignature(BODY, SIGNATURE, 'other-key')).toBe(false);
    expect(verifyWebhookSignature(BODY, undefined, KEY)).toBe(false);
    expect(verifyWebhookSignature(BODY, SIGNATURE.slice('sha256='.length), KEY)).toBe(false);
    expect(verifyWebhookSignature(BODY, SIGNATURE, '')).toBe(false);
  });
});

describe('webhook payloads', () => {
  it('parse the documented motion_detected shape and keep subType', () => {
    const body = {
      meta: { version: '1.1', time: '2025-07-06T11:11:00Z', request_id: 'req-9', account_id: 'acct' },
      data: {
        id: 'evt-9',
        type: 'motion_detected',
        subType: 'human',
        attributes: { source: 'dev-1', source_type: 'devices', timestamp: 1699457230000 },
        relationships: { devices: { links: { self: '/v1/devices/dev-1' } } },
      },
    };
    const payload = WebhookPayloadSchema.parse(body);
    expect(fromWebhook(payload)).toEqual({
      id: 'evt-9',
      deviceId: 'dev-1',
      type: 'motion_detected',
      subType: 'human',
      occurredAt: 1699457230000,
      via: 'webhook',
      raw: body,
    });
  });
});
