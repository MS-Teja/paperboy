import { and, eq, max } from 'drizzle-orm';
import { pollDeviceHistory, type RingClient, type RingEvent } from 'ring-partner-kit';
import type { Db } from '../db/client.ts';
import { devices, events, homes, type EventSource } from '../db/schema.ts';

export interface HomeSeed {
  id: string;
  name: string;
  timezone?: string;
  parentName?: string;
  parentTelegramChatId?: string;
}

/** Creates the home if it doesn't exist yet; never overwrites one that does. */
export function ensureHome(db: Db, home: HomeSeed): void {
  db.insert(homes).values(home).onConflictDoNothing().run();
}

/** Registers the Ring devices this token can see under a home, keeping names current. */
export async function syncDevices(db: Db, ring: RingClient, homeId: string): Promise<number> {
  const list = await ring.listDevices();
  for (const device of list.data) {
    db.insert(devices)
      .values({ homeId, ringDeviceId: device.id, name: device.attributes.name })
      .onConflictDoUpdate({ target: devices.ringDeviceId, set: { name: device.attributes.name } })
      .run();
  }
  return list.data.length;
}

/**
 * Stores events, skipping any Ring event ID already present. Events for devices
 * we don't know are skipped too. Returns how many rows were new.
 */
export function storeEvents(db: Db, incoming: RingEvent[], source: EventSource): { inserted: number; duplicate: number; unknownDevice: number } {
  const result = { inserted: 0, duplicate: 0, unknownDevice: 0 };
  db.transaction((tx) => {
    for (const event of incoming) {
      const device = tx.select({ id: devices.id }).from(devices).where(eq(devices.ringDeviceId, event.deviceId)).get();
      if (!device) {
        result.unknownDevice++;
        continue;
      }
      const inserted = tx
        .insert(events)
        .values({
          ringEventId: event.id,
          deviceId: device.id,
          type: event.type,
          subType: event.subType,
          occurredAt: new Date(event.occurredAt),
          source,
          raw: event.raw,
        })
        .onConflictDoNothing({ target: events.ringEventId })
        .run();
      if (inserted.changes > 0) result.inserted++;
      else result.duplicate++;
    }
  });
  return result;
}

export interface PollResult {
  deviceName: string;
  fetched: number;
  inserted: number;
  duplicate: number;
}

/**
 * One intake pass: for each known device, read history back to the newest event
 * already stored from history (minus an overlap) and store what's new.
 */
export async function pollAllDevices(db: Db, ring: RingClient): Promise<PollResult[]> {
  const results: PollResult[] = [];
  for (const device of db.select().from(devices).all()) {
    const newest = db
      .select({ at: max(events.occurredAt) })
      .from(events)
      .where(and(eq(events.deviceId, device.id), eq(events.source, 'history')))
      .get();
    const since = newest?.at ? newest.at.getTime() : undefined;
    const fetched = await pollDeviceHistory(ring, device.ringDeviceId, { since });
    const stored = storeEvents(db, fetched, 'history');
    results.push({ deviceName: device.name, fetched: fetched.length, inserted: stored.inserted, duplicate: stored.duplicate });
  }
  return results;
}
