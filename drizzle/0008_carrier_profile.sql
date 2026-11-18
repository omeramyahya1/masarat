CREATE TABLE `drivers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`name` text NOT NULL,
	`phone` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drivers_owner_phone_idx` ON `drivers` (`owner_id`,`phone`);--> statement-breakpoint
ALTER TABLE `users` ADD `address` text;--> statement-breakpoint
ALTER TABLE `users` ADD `tin` text;--> statement-breakpoint
ALTER TABLE `vehicles` ADD `registration_no` text;--> statement-breakpoint
-- Demo owners are reseeded with their address, TIN, vehicle registration numbers and drivers:
-- delete every trip and the demo owners (the next startup seeds them again). Other accounts and
-- their vehicles are kept.
DELETE FROM `esali_sim_bills`;--> statement-breakpoint
DELETE FROM `certificates`;--> statement-breakpoint
DELETE FROM `payments`;--> statement-breakpoint
DELETE FROM `manifest_taxes`;--> statement-breakpoint
DELETE FROM `manifest_cargo_items`;--> statement-breakpoint
DELETE FROM `manifests`;--> statement-breakpoint
DELETE FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
DELETE FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner';
