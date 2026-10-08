import type { RingClient } from './client.ts';
import { fromHistoryEvent, type RingEvent } from './events.ts';

export interface PollOptions {
  /** Epoch ms of the newest event already stored; omit on the first poll. */
  since?: number;
  /** Re-read this far behind `since` to catch late-arriving events. Default 10 minutes. */
  overlapMs?: number;
  /** Upper bound on events read in one poll. Default 500. */
  maxEvents?: number;
  /** Passed to Ring, but don't rely on it: it isn't always applied. Check `type` yourself. */
  eventTypes?: string[];
}

/**
 * Reads a device's history newest first and stops once events are older than
 * `since - overlapMs`. Returns events oldest first. Overlapping reads mean
 * duplicates are expected; de-duplicate on `RingEvent.id` when storing.
 * `429`s are retried by the client.
 */
export async function pollDeviceHistory(
  client: RingClient,
  deviceId: string,
  options: PollOptions = {},
): Promise<RingEvent[]> {
  const { since, overlapMs = 10 * 60_000, maxEvents = 500, eventTypes } = options;
  const cutoff = since === undefined ? -Infinity : since - overlapMs;
  const events: RingEvent[] = [];

  for await (const event of client.iterateHistory(deviceId, { eventTypes })) {
    if (event.attributes.start < cutoff) break;
    events.push(fromHistoryEvent(event, deviceId));
    if (events.length >= maxEvents) break;
  }
  return events.reverse();
}
