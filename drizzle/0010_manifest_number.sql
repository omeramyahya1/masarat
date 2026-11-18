-- Certificates are reissued with a manifest number, not migrated: delete every trip and the demo
-- owners (the next startup seeds them again). Other accounts, their vehicles and drivers are kept.
DELETE FROM `esali_sim_bills`;--> statement-breakpoint
DELETE FROM `certificates`;--> statement-breakpoint
DELETE FROM `payments`;--> statement-breakpoint
DELETE FROM `manifest_taxes`;--> statement-breakpoint
DELETE FROM `manifest_cargo_items`;--> statement-breakpoint
DELETE FROM `manifest_trailers`;--> statement-breakpoint
DELETE FROM `manifests`;--> statement-breakpoint
DELETE FROM `drivers` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
DELETE FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
DELETE FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner';--> statement-breakpoint
-- SQLite can't add a NOT NULL column without a default, so the (now empty) table is rebuilt
DROP TABLE `certificates`;--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manifest_id` integer NOT NULL,
	`certificate_no` text NOT NULL,
	`manifest_no` text NOT NULL,
	`qr_token` text NOT NULL,
	`issued_at` integer DEFAULT (unixepoch()) NOT NULL,
	`valid_until` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`manifest_id`) REFERENCES `manifests`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_manifest_id_unique` ON `certificates` (`manifest_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_certificate_no_unique` ON `certificates` (`certificate_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_manifest_no_unique` ON `certificates` (`manifest_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_qr_token_unique` ON `certificates` (`qr_token`);
