import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Section 5.1 of the project brief. Tables arrive with the milestone that needs them:
// homes, devices and events now; daily summaries, checks and escalations later.
// No table ever has a column for image bytes.

/** Per-home settings. Filled in by later milestones (wait times, activity window, demo flags). */
export type HomeConfig = Record<string, unknown>;

export const homes = sqliteTable('homes', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  parentName: text('parent_name'),
  parentTelegramChatId: text('parent_telegram_chat_id'),
  neighbourName: text('neighbour_name'),
  neighbourTelegramChatId: text('neighbour_telegram_chat_id'),
  config: text('config', { mode: 'json' }).$type<HomeConfig>().notNull().default(sql`'{}'`),
});

export const devices = sqliteTable('devices', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  homeId: text('home_id')
    .notNull()
    .references(() => homes.id),
  ringDeviceId: text('ring_device_id').notNull().unique(),
  name: text('name').notNull(),
  /** Set at setup; Ring advises against inferring device type from capabilities. */
  kind: text('kind'),
});

export const eventSources = ['history', 'webhook', 'replay'] as const;
export type EventSource = (typeof eventSources)[number];

export const events = sqliteTable(
  'events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    ringEventId: text('ring_event_id').notNull().unique(),
    deviceId: integer('device_id')
      .notNull()
      .references(() => devices.id),
    /** Webhook vocabulary: motion_detected, button_press, on_demand, device_online, … */
    type: text('type').notNull(),
    subType: text('sub_type'),
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    source: text('source', { enum: eventSources }).notNull(),
    /** The Ring event or webhook payload as received. Metadata only; never media. */
    raw: text('raw', { mode: 'json' }),
  },
  (t) => [index('events_device_occurred_at').on(t.deviceId, t.occurredAt)],
);

/** Webhook `meta.request_id`s already handled, so a redelivery is processed once. */
export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  requestId: text('request_id').primaryKey(),
  receivedAt: integer('received_at', { mode: 'timestamp_ms' }).notNull(),
});
