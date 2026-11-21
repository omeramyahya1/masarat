PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- The demo owners are reseeded with the fee (the next startup seeds them again): delete them and
-- everything under them. Other owners' trips are kept as they are; bills already issued keep
-- their lines and amounts.
DELETE FROM `esali_sim_bills` WHERE `bill_id` IN (SELECT `bill_id` FROM `payments` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner'))));--> statement-breakpoint
DELETE FROM `certificates` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `payments` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifest_taxes` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifest_cargo_items` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifests` WHERE `id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
DELETE FROM `users` WHERE `id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
CREATE TABLE `__new_manifest_taxes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manifest_id` integer NOT NULL,
	`code` text NOT NULL,
	`rate_bps` integer,
	`amount` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`manifest_id`) REFERENCES `manifests`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "manifest_taxes_code_check" CHECK("__new_manifest_taxes"."code" IN ('vat', 'business_profit', 'locality', 'manifest_fee'))
);
--> statement-breakpoint
INSERT INTO `__new_manifest_taxes`("id", "manifest_id", "code", "rate_bps", "amount", "created_at", "updated_at") SELECT "id", "manifest_id", "code", "rate_bps", "amount", "created_at", "updated_at" FROM `manifest_taxes`;--> statement-breakpoint
DROP TABLE `manifest_taxes`;--> statement-breakpoint
ALTER TABLE `__new_manifest_taxes` RENAME TO `manifest_taxes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `manifest_taxes_manifest_code_idx` ON `manifest_taxes` (`manifest_id`,`code`);--> statement-breakpoint
CREATE TABLE `__new_tax_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`rate_bps` integer,
	`amount` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "tax_settings_code_check" CHECK("__new_tax_settings"."code" IN ('vat', 'business_profit', 'locality', 'manifest_fee')),
	CONSTRAINT "tax_settings_value_check" CHECK(("__new_tax_settings"."code" IN ('vat', 'business_profit', 'locality') AND "__new_tax_settings"."rate_bps" BETWEEN 0 AND 10000 AND "__new_tax_settings"."amount" IS NULL)
        OR ("__new_tax_settings"."code" IN ('manifest_fee') AND "__new_tax_settings"."amount" BETWEEN 0 AND 1000000 AND "__new_tax_settings"."rate_bps" IS NULL))
);
--> statement-breakpoint
INSERT INTO `__new_tax_settings`("id", "code", "rate_bps", "amount", "created_at", "updated_at") SELECT "id", "code", "rate_bps", NULL, "created_at", "updated_at" FROM `tax_settings`;--> statement-breakpoint
DROP TABLE `tax_settings`;--> statement-breakpoint
ALTER TABLE `__new_tax_settings` RENAME TO `tax_settings`;--> statement-breakpoint
CREATE UNIQUE INDEX `tax_settings_code_unique` ON `tax_settings` (`code`);--> statement-breakpoint
ALTER TABLE `tax_setting_changes` RENAME COLUMN `old_bps` TO `old_value`;--> statement-breakpoint
ALTER TABLE `tax_setting_changes` RENAME COLUMN `new_bps` TO `new_value`;--> statement-breakpoint
INSERT INTO `tax_settings` (`code`, `amount`) VALUES ('manifest_fee', 1500);