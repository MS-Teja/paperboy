// pnpm ring:smoke — checks the Ring connection with the current token: devices,
// device status, the last 20 history events and one snapshot. The snapshot is
// held in memory to report its size and is never written anywhere.

import {
  findIncluded,
  RingApiError,
  type Device,
  type HistoryEvent,
  type ImageDownloadRequest,
  type RingImage,
} from 'ring-partner-kit';
import { createRingClient, isTokenExpired, TOKEN_EXPIRED_MESSAGE } from '../src/ring/client.ts';

const TIMEZONE = 'Asia/Kolkata';
const HISTORY_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const ist = new Intl.DateTimeFormat('en-IN', {
  timeZone: TIMEZONE,
  dateStyle: 'medium',
  timeStyle: 'medium',
  hourCycle: 'h23',
});
const at = (ms: number) => `${ist.format(ms)} IST`;

function describeError(err: unknown): string {
  if (err instanceof RingApiError) return err.message;
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** Stops the whole smoke run on an expired token; any other failure is reported and the run continues. */
async function step<T>(title: string, run: () => Promise<T>): Promise<T | undefined> {
  console.log(`\n== ${title}`);
  try {
    return await run();
  } catch (err) {
    if (isTokenExpired(err)) {
      console.error(TOKEN_EXPIRED_MESSAGE);
      process.exit(2);
    }
    console.log(`   FAILED: ${describeError(err)}`);
    return undefined;
  }
}

async function main() {
  let ring;
  try {
    ring = createRingClient();
  } catch (err) {
    console.error(describeError(err));
    process.exit(1);
  }

  console.log(`Ring smoke test, ${at(Date.now())}`);

  const devices = await step('Devices (GET /v1/devices?include=status,capabilities)', async () => {
    const list = await ring.listDevices(['status', 'capabilities']);
    for (const device of list.data) {
      const status = findIncluded(list, device, 'status');
      const online = status?.attributes?.online;
      console.log(`   ${device.attributes.name}  [${online === true ? 'online' : online === false ? 'OFFLINE' : 'status unknown'}]`);
      console.log(`     id: ${device.id}`);
      const capabilities = findIncluded(list, device, 'capabilities')?.attributes;
      if (capabilities) console.log(`     capabilities: ${Object.keys(capabilities).join(', ') || '(none)'}`);
    }
    console.log(`   ${list.data.length} device(s)`);
    return list.data;
  });

  const device: Device | undefined = devices?.[0];
  if (!device) {
    console.log('\nNo device visible to this token. Stopping here: M1 needs at least one device.');
    process.exit(1);
  }

  await step(`Status of "${device.attributes.name}" (GET /v1/devices/{id}/status)`, async () => {
    const status = await ring.getDeviceStatus(device.id);
    const { online, reported_at, ...rest } = status.attributes;
    console.log(`   online: ${online}`);
    if (reported_at) console.log(`   reported_at: ${reported_at}`);
    const other = Object.keys(rest);
    if (other.length) console.log(`   other attributes: ${other.join(', ')}`);
  });

  const events = await step(`Last ${HISTORY_LIMIT} history events (GET /v1/history/devices/{id}/events)`, async () => {
    const seen: HistoryEvent[] = [];
    for await (const event of ring.iterateHistory(device.id)) {
      seen.push(event);
      if (seen.length >= HISTORY_LIMIT) break;
    }
    if (seen.length === 0) console.log('   (no events yet)');
    const attributeKeys = new Set<string>();
    for (const e of seen) {
      const { event_type, start, end } = e.attributes;
      const seconds = end ? `${Math.round((end - start) / 1000)}s` : '';
      console.log(`   ${at(start)}  ${event_type.padEnd(10)} ${seconds.padStart(5)}  …${e.id.slice(-8)}`);
      for (const key of Object.keys(e.attributes)) attributeKeys.add(key);
    }
    if (seen.length) console.log(`   attribute keys seen: ${[...attributeKeys].join(', ')}`);
    return seen;
  });

  await step('Human motion filter (event_types=motion.human)', async () => {
    const page = await ring.getHistoryPage(device.id, { eventTypes: ['motion.human'] });
    console.log(`   ${page.data.length} event(s) on the first page`);
    const newest = page.data[0];
    if (newest) console.log(`   newest: ${at(newest.attributes.start)} ${newest.attributes.event_type}`);
  });

  await step('Snapshot (POST /v1/devices/{id}/media/image/download, latest in the last 24 h)', async () => {
    const now = Date.now();
    const attempts: Array<{ label: string; request: ImageDownloadRequest }> = [
      { label: 'latest_in_range', request: { type: 'latest_in_range', startTimestamp: now - DAY_MS + 60_000 } },
    ];
    const newest = events?.[0];
    if (newest) {
      attempts.push({
        label: `at_timestamp of newest event (${at(newest.attributes.start)})`,
        request: { type: 'at_timestamp', timestamp: newest.attributes.start },
      });
    }

    for (const { label, request } of attempts) {
      try {
        let image: RingImage | undefined = await ring.downloadImage(device.id, request);
        console.log(`   ${label}: OK`);
        console.log(`     ${image.bytes.byteLength} bytes, ${image.contentType ?? 'unknown type'}, origin ${image.mediaOrigin ?? 'unknown'}`);
        if (image.mediaTimestamp) console.log(`     frame time: ${at(image.mediaTimestamp)}`);
        image = undefined; // Size only. The bytes are dropped here and never saved.
        console.log('     image discarded (not saved)');
        return;
      } catch (err) {
        if (isTokenExpired(err)) throw err;
        console.log(`   ${label}: ${describeError(err)}`);
      }
    }
  });

  console.log('\nDone.');
}

await main();
