-- Demo owners are reseeded with manifest numbers: delete them and everything under them (the next
-- startup seeds them again). Other owners' certificates are kept and get their manifest number.
DELETE FROM `esali_sim_bills` WHERE `bill_id` IN (SELECT `bill_id` FROM `payments` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner'))));--> statement-breakpoint
DELETE FROM `certificates` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `payments` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifest_taxes` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifest_cargo_items` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifest_trailers` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifests` WHERE `id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `drivers` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
DELETE FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
DELETE FROM `users` WHERE `id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
-- SQLite can't add a NOT NULL column without a default, so the table is rebuilt; the manifest
-- number follows the receipt's: MNF-<year issued>-<manifest id, 6 digits>
CREATE TABLE `__new_certificates` (
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
INSERT INTO `__new_certificates`("id", "manifest_id", "certificate_no", "manifest_no", "qr_token", "issued_at", "valid_until", "created_at", "updated_at") SELECT "id", "manifest_id", "certificate_no", 'MNF-' || strftime('%Y', "issued_at", 'unixepoch', 'localtime') || '-' || printf('%06d', "manifest_id"), "qr_token", "issued_at", "valid_until", "created_at", "updated_at" FROM `certificates`;--> statement-breakpoint
DROP TABLE `certificates`;--> statement-breakpoint
ALTER TABLE `__new_certificates` RENAME TO `certificates`;--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_manifest_id_unique` ON `certificates` (`manifest_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_certificate_no_unique` ON `certificates` (`certificate_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_manifest_no_unique` ON `certificates` (`manifest_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_qr_token_unique` ON `certificates` (`qr_token`);
