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
-- delete them and everything under them (the next startup seeds them again). Other owners and
-- their trips are kept.
DELETE FROM `esali_sim_bills` WHERE `bill_id` IN (SELECT `bill_id` FROM `payments` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner'))));--> statement-breakpoint
DELETE FROM `certificates` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `payments` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifest_taxes` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifest_cargo_items` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifests` WHERE `id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
DELETE FROM `users` WHERE `id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');
