CREATE TABLE `devices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`home_id` text NOT NULL,
	`ring_device_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text,
	FOREIGN KEY (`home_id`) REFERENCES `homes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `devices_ring_device_id_unique` ON `devices` (`ring_device_id`);--> statement-breakpoint
CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ring_event_id` text NOT NULL,
	`device_id` integer NOT NULL,
	`type` text NOT NULL,
	`sub_type` text,
	`occurred_at` integer NOT NULL,
	`source` text NOT NULL,
	`raw` text,
	FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `events_ring_event_id_unique` ON `events` (`ring_event_id`);--> statement-breakpoint
CREATE INDEX `events_device_occurred_at` ON `events` (`device_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `homes` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Kolkata' NOT NULL,
	`parent_name` text,
	`parent_telegram_chat_id` text,
	`neighbour_name` text,
	`neighbour_telegram_chat_id` text,
	`config` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`request_id` text PRIMARY KEY NOT NULL,
	`received_at` integer NOT NULL
);
