import type { HistoryEvent } from './schemas.ts';
import type { WebhookPayload } from './webhooks.ts';

/**
 * One event shape for both delivery paths. Event History and webhooks name the
 * same things differently (`motion` vs `motion_detected`, `ding` vs `button_press`);
 * this uses the webhook vocabulary. Unknown types pass through unchanged.
 */
export interface RingEvent {
  /** Ring's event ID, for de-duplication across polls (and across paths where IDs match). */
  id: string;
  deviceId: string;
  type: string;
  /** Detection class such as `human`. Webhooks carry it; history events currently don't. */
  subType: string | null;
  /** Epoch milliseconds. */
  occurredAt: number;
  via: 'history' | 'webhook';
}

const HISTORY_TO_WEBHOOK_TYPE: Record<string, string> = {
  motion: 'motion_detected',
  ding: 'button_press',
};

export function fromHistoryEvent(event: HistoryEvent, deviceId: string): RingEvent {
  const source = event.relationships?.source?.data;
  return {
    id: event.id,
    deviceId: source && !Array.isArray(source) ? source.id : deviceId,
    type: HISTORY_TO_WEBHOOK_TYPE[event.attributes.event_type] ?? event.attributes.event_type,
    subType: null,
    occurredAt: event.attributes.start,
    via: 'history',
  };
}

export function fromWebhook(payload: WebhookPayload): RingEvent {
  return {
    id: payload.data.id,
    deviceId: payload.data.attributes.source,
    type: payload.data.type,
    subType: payload.data.subType ?? null,
    occurredAt: payload.data.attributes.timestamp,
    via: 'webhook',
  };
}
