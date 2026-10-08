import { createHash } from 'node:crypto';

const SECRET_KEY = /token|secret|signature|authorization|password|cookie/i;
const JWT = /^eyJ[\w-]+\.[\w-]+\.[\w-]+$/;
// Ring directed IDs look like `ava1.ring.device.status.<long base32 id>`.
const RING_ID = /\bava1\.ring\.((?:[a-z_]+\.)+)([A-Z0-9]{16,})\b/g;

/**
 * Prepares a Ring payload for committing as a fixture: secret-named keys and
 * JWTs are redacted, URL query strings (pre-signed signatures) are dropped, and
 * Ring IDs become short stable placeholders. The same real ID always maps to the
 * same placeholder, so cross-references inside and between fixtures still match.
 */
export function scrub(value: unknown, key = ''): unknown {
  if (typeof value === 'string') {
    if (SECRET_KEY.test(key) || JWT.test(value)) return '<redacted>';
    const withoutIds = value.replace(RING_ID, (_, kind: string, id: string) => `ava1.ring.${kind}fixture-${shortHash(id)}`);
    if (/^https?:\/\//.test(withoutIds) && withoutIds.includes('?')) return `${withoutIds.split('?')[0]}?<redacted>`;
    return withoutIds;
  }
  if (Array.isArray(value)) return value.map((v) => scrub(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  }
  return value;
}

function shortHash(id: string): string {
  return createHash('sha256').update(id).digest('hex').slice(0, 12);
}
