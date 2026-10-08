// pnpm ring:capture — saves real Ring responses into fixtures/ring/ as test and
// payload references. Secrets are scrubbed before writing, and a fixture is refused
// if the access token still appears in it. Image bytes are never captured: for the
// snapshot endpoint only status codes, header names and error bodies are saved.
// Ring IDs are replaced with stable placeholders (see src/ring/scrub.ts).

import { mkdir, writeFile } from 'node:fs/promises';
import type { RingClient } from 'ring-partner-kit';
import { createRingClient, isTokenExpired, TOKEN_EXPIRED_MESSAGE } from '../src/ring/client.ts';
import { scrub } from '../src/ring/scrub.ts';

const FIXTURES_DIR = new URL('../../../fixtures/ring/', import.meta.url);
const DAY_MS = 24 * 60 * 60 * 1000;

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { non_json_body_length: text.length };
  }
}

function pickHeaders(res: Response, names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = res.headers.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}

/** Ring returns object keys in varying order; sorting keeps fixture diffs meaningful. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return value;
}

async function save(name: string, fixture: object, token: string) {
  const scrubbed = sortKeys(scrub({ captured_at: new Date().toISOString(), ...fixture }));
  const text = `${JSON.stringify(scrubbed, null, 2)}\n`;
  if (text.includes(token)) throw new Error(`Refusing to write ${name}: the access token is still present after scrubbing.`);
  await writeFile(new URL(name, FIXTURES_DIR), text);
  console.log(`   wrote fixtures/ring/${name}`);
}

async function captureGet(ring: RingClient, token: string, name: string, path: string, pathTemplate: string) {
  const res = await ring.request(path);
  if (res.status === 401) throw Object.assign(new Error(TOKEN_EXPIRED_MESSAGE), { expired: true });
  const body = await readBody(res);
  await save(name, { request: { method: 'GET', path: pathTemplate }, status: res.status, body }, token);
  return body;
}

async function captureImageDownload(
  ring: RingClient,
  token: string,
  deviceId: string,
  name: string,
  requestBody: Record<string, unknown>,
) {
  const path = `/v1/devices/${encodeURIComponent(deviceId)}/media/image/download`;
  const step1 = await ring.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody),
    redirect: 'manual',
  });
  if (step1.status === 401) throw Object.assign(new Error(TOKEN_EXPIRED_MESSAGE), { expired: true });

  const location = step1.headers.get('location');
  const fixture: Record<string, unknown> = {
    request: { method: 'POST', path: '/v1/devices/{device_id}/media/image/download', body: requestBody },
    step1: {
      status: step1.status,
      header_names: [...step1.headers.keys()],
      headers: pickHeaders(step1, ['content-type', 'location', 'x-request-id']),
      body: await readBody(step1),
    },
  };

  if (step1.status === 303 && location) {
    // The pre-signed URL carries its own credentials; no bearer token here.
    const step2 = await fetch(new URL(location, 'https://api.amazonvision.com'));
    const step2Info: Record<string, unknown> = {
      status: step2.status,
      header_names: [...step2.headers.keys()],
      headers: pickHeaders(step2, ['content-type', 'content-length', 'x-request-id', 'x-media-timestamp', 'x-media-origin']),
    };
    if (step2.ok) {
      // Count the bytes, then drop them. Media is never written to disk.
      step2Info.image_bytes = (await step2.arrayBuffer()).byteLength;
    } else {
      step2Info.body = await readBody(step2);
    }
    fixture.step2 = step2Info;
  }

  await save(name, fixture, token);
}

async function main() {
  let ring: RingClient;
  try {
    ring = createRingClient();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
  const token = process.env.RING_ACCESS_TOKEN!.trim();

  await mkdir(FIXTURES_DIR, { recursive: true });
  console.log('Capturing Ring responses into fixtures/ring/');

  try {
    const devices = (await captureGet(
      ring, token, 'devices.json',
      '/v1/devices?include=status,capabilities,configurations,location',
      '/v1/devices?include=status,capabilities,configurations,location',
    )) as { data?: Array<{ id: string }> } | null;

    const deviceId = devices?.data?.[0]?.id;
    if (!deviceId) {
      console.log('   no device visible; stopping after devices.json');
      return;
    }
    const id = encodeURIComponent(deviceId);
    await captureGet(ring, token, 'device-status.json', `/v1/devices/${id}/status`, '/v1/devices/{device_id}/status');
    await captureGet(ring, token, 'history-events.json', `/v1/history/devices/${id}/events`, '/v1/history/devices/{device_id}/events');
    const history = (await captureGet(
      ring, token, 'history-events-human-or-ding.json',
      `/v1/history/devices/${id}/events?event_types=motion.human,ding`,
      '/v1/history/devices/{device_id}/events?event_types=motion.human,ding',
    )) as { data?: Array<{ attributes?: { start?: number } }> } | null;

    await captureImageDownload(ring, token, deviceId, 'image-download-latest-in-range.json', {
      type: 'latest_in_range',
      start_timestamp: Date.now() - DAY_MS + 60_000,
    });
    const newestStart = history?.data?.[0]?.attributes?.start;
    if (newestStart) {
      await captureImageDownload(ring, token, deviceId, 'image-download-at-event.json', {
        type: 'at_timestamp',
        timestamp: newestStart,
      });
    }
  } catch (err) {
    if (isTokenExpired(err) || (err as { expired?: boolean }).expired) {
      console.error(TOKEN_EXPIRED_MESSAGE);
      process.exit(2);
    }
    throw err;
  }
  console.log('Done. Review the files before committing.');
}

await main();
