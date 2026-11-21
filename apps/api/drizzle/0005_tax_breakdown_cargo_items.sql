CREATE TABLE `manifest_cargo_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manifest_id` integer NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`manifest_id`) REFERENCES `manifests`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "manifest_cargo_items_unit_check" CHECK("manifest_cargo_items"."unit" IN ('kg', 'ton', 'liter', 'm3')),
	CONSTRAINT "manifest_cargo_items_quantity_check" CHECK("manifest_cargo_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `manifest_cargo_items_manifest_id_idx` ON `manifest_cargo_items` (`manifest_id`);--> statement-breakpoint
CREATE TABLE `manifest_taxes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manifest_id` integer NOT NULL,
	`code` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`amount` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`manifest_id`) REFERENCES `manifests`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "manifest_taxes_code_check" CHECK("manifest_taxes"."code" IN ('vat', 'business_profit', 'locality'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manifest_taxes_manifest_code_idx` ON `manifest_taxes` (`manifest_id`,`code`);--> statement-breakpoint
CREATE TABLE `tax_setting_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`old_bps` integer NOT NULL,
	`new_bps` integer NOT NULL,
	`changed_by` integer NOT NULL,
	`changed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`changed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `tax_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`rate_bps` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "tax_settings_code_check" CHECK("tax_settings"."code" IN ('vat', 'business_profit', 'locality')),
	CONSTRAINT "tax_settings_rate_check" CHECK("tax_settings"."rate_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_settings_code_unique` ON `tax_settings` (`code`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_manifests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vehicle_id` integer NOT NULL,
	`origin_city_id` integer NOT NULL,
	`destination_city_id` integer NOT NULL,
	`cargo_type` text NOT NULL,
	`cargo_quantity` real NOT NULL,
	`cargo_unit` text NOT NULL,
	`trip_date` integer NOT NULL,
	`distance_km` real NOT NULL,
	`rate_per_km` integer NOT NULL,
	`trip_cost` integer NOT NULL,
	`tax_amount` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`origin_city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`destination_city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "manifests_route_check" CHECK("__new_manifests"."origin_city_id" <> "__new_manifests"."destination_city_id"),
	CONSTRAINT "manifests_cargo_type_check" CHECK("__new_manifests"."cargo_type" IN ('fuel', 'liquids', 'containers', 'general_cargo')),
	CONSTRAINT "manifests_unit_check" CHECK("__new_manifests"."cargo_unit" IN ('ton', 'liter')),
	CONSTRAINT "manifests_status_check" CHECK("__new_manifests"."status" IN ('draft', 'billed', 'paid', 'certified', 'cancelled')),
	CONSTRAINT "manifests_quantity_check" CHECK("__new_manifests"."cargo_quantity" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_manifests`("id", "vehicle_id", "origin_city_id", "destination_city_id", "cargo_type", "cargo_quantity", "cargo_unit", "trip_date", "distance_km", "rate_per_km", "trip_cost", "tax_amount", "status", "created_at", "updated_at") SELECT "id", "vehicle_id", "origin_city_id", "destination_city_id", "cargo_type", "cargo_quantity", "cargo_unit", "trip_date", "distance_km", "rate_per_km", "tax_amount", 0, "status", "created_at", "updated_at" FROM `manifests`;--> statement-breakpoint
DROP TABLE `manifests`;--> statement-breakpoint
ALTER TABLE `__new_manifests` RENAME TO `manifests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `manifests_vehicle_id_idx` ON `manifests` (`vehicle_id`);--> statement-breakpoint
CREATE INDEX `manifests_status_idx` ON `manifests` (`status`);--> statement-breakpoint
CREATE TABLE `__new_tax_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cargo_type` text NOT NULL,
	`rate_per_km` integer NOT NULL,
	`unit` text NOT NULL,
	`per_quantity` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "tax_rates_cargo_type_check" CHECK("__new_tax_rates"."cargo_type" IN ('fuel', 'liquids', 'containers', 'general_cargo')),
	CONSTRAINT "tax_rates_unit_check" CHECK("__new_tax_rates"."unit" IN ('ton', 'liter'))
);
--> statement-breakpoint
INSERT INTO `__new_tax_rates`("id", "cargo_type", "rate_per_km", "unit", "per_quantity", "created_at", "updated_at") SELECT "id", "cargo_type", "rate_per_km", "unit", "per_quantity", "created_at", "updated_at" FROM `tax_rates`;--> statement-breakpoint
DROP TABLE `tax_rates`;--> statement-breakpoint
ALTER TABLE `__new_tax_rates` RENAME TO `tax_rates`;--> statement-breakpoint
CREATE UNIQUE INDEX `tax_rates_cargo_type_unique` ON `tax_rates` (`cargo_type`);--> statement-breakpoint
INSERT INTO `tax_rates` (`cargo_type`, `rate_per_km`, `unit`, `per_quantity`) VALUES ('liquids', 2000, 'liter', 1000);--> statement-breakpoint
INSERT INTO `tax_settings` (`code`, `rate_bps`) VALUES ('vat', 1700), ('business_profit', 300), ('locality', 200);--> statement-breakpoint
INSERT INTO `manifest_taxes` (`manifest_id`, `code`, `rate_bps`, `amount`, `created_at`, `updated_at`)
SELECT m.`id`, s.`code`, s.`rate_bps`, CAST(ROUND(m.`trip_cost` * s.`rate_bps` / 10000.0) AS INTEGER), m.`created_at`, m.`updated_at`
FROM `manifests` m CROSS JOIN `tax_settings` s;--> statement-breakpoint
UPDATE `manifests` SET `tax_amount` = (SELECT SUM(`amount`) FROM `manifest_taxes` t WHERE t.`manifest_id` = `manifests`.`id`);--> statement-breakpoint
UPDATE `payments` SET `amount` = (SELECT m.`tax_amount` FROM `manifests` m WHERE m.`id` = `payments`.`manifest_id`);--> statement-breakpoint
UPDATE `esali_sim_bills` SET `amount` = (SELECT p.`amount` FROM `payments` p WHERE p.`bill_id` = `esali_sim_bills`.`bill_id`)
WHERE `bill_id` IN (SELECT `bill_id` FROM `payments`);
