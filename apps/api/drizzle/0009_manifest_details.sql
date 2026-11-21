-- Demo owners are reseeded with the manifest details: delete them and everything under them (the
-- next startup seeds them again). Other owners' trips are copied into the rebuilt tables; their
-- new fields start empty (trip type domestic).
DELETE FROM `esali_sim_bills` WHERE `bill_id` IN (SELECT `bill_id` FROM `payments` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner'))));--> statement-breakpoint
DELETE FROM `certificates` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `payments` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifest_taxes` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifest_cargo_items` WHERE `manifest_id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `manifests` WHERE `id` IN (SELECT `id` FROM `manifests` WHERE `vehicle_id` IN (SELECT `id` FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner')));--> statement-breakpoint
DELETE FROM `drivers` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
DELETE FROM `vehicles` WHERE `owner_id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
DELETE FROM `users` WHERE `id` IN (SELECT `id` FROM `users` WHERE `is_demo` = 1 AND `role` = 'owner');--> statement-breakpoint
CREATE TABLE `manifest_trailers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manifest_id` integer NOT NULL,
	`position` integer NOT NULL,
	`plate_number` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`manifest_id`) REFERENCES `manifests`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `manifest_trailers_manifest_id_idx` ON `manifest_trailers` (`manifest_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_manifest_cargo_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manifest_id` integer NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`cargo_type` text NOT NULL,
	`rate_per_km` integer NOT NULL,
	`per_quantity` integer NOT NULL,
	`cost` integer NOT NULL,
	`packing_type` text,
	`package_count` integer,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`manifest_id`) REFERENCES `manifests`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "manifest_cargo_items_cargo_type_check" CHECK("__new_manifest_cargo_items"."cargo_type" IN ('fuel', 'liquids', 'containers', 'general_cargo')),
	CONSTRAINT "manifest_cargo_items_unit_check" CHECK("__new_manifest_cargo_items"."unit" IN ('kg', 'ton', 'liter', 'm3')),
	CONSTRAINT "manifest_cargo_items_package_count_check" CHECK("__new_manifest_cargo_items"."package_count" IS NULL OR "__new_manifest_cargo_items"."package_count" > 0),
	CONSTRAINT "manifest_cargo_items_quantity_check" CHECK("__new_manifest_cargo_items"."quantity" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_manifest_cargo_items`("id", "manifest_id", "position", "name", "quantity", "unit", "cargo_type", "rate_per_km", "per_quantity", "cost", "created_at", "updated_at") SELECT "id", "manifest_id", "position", "name", "quantity", "unit", "cargo_type", "rate_per_km", "per_quantity", "cost", "created_at", "updated_at" FROM `manifest_cargo_items`;--> statement-breakpoint
DROP TABLE `manifest_cargo_items`;--> statement-breakpoint
ALTER TABLE `__new_manifest_cargo_items` RENAME TO `manifest_cargo_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `manifest_cargo_items_manifest_id_idx` ON `manifest_cargo_items` (`manifest_id`);--> statement-breakpoint
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
	`trip_kind` text DEFAULT 'domestic' NOT NULL,
	`driver_id` integer,
	`driver_name` text,
	`driver_phone` text,
	`shipper_name` text,
	`shipper_address` text,
	`shipper_phone` text,
	`receiver_name` text,
	`receiver_address` text,
	`receiver_phone` text,
	`carrier_name` text,
	`carrier_address` text,
	`carrier_tin` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`origin_city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`destination_city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`driver_id`) REFERENCES `drivers`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "manifests_trip_kind_check" CHECK("__new_manifests"."trip_kind" IN ('domestic', 'import', 'export')),
	CONSTRAINT "manifests_route_check" CHECK("__new_manifests"."origin_city_id" <> "__new_manifests"."destination_city_id"),
	CONSTRAINT "manifests_cargo_type_check" CHECK("__new_manifests"."cargo_type" IN ('fuel', 'liquids', 'containers', 'general_cargo')),
	CONSTRAINT "manifests_unit_check" CHECK("__new_manifests"."cargo_unit" IN ('ton', 'liter')),
	CONSTRAINT "manifests_status_check" CHECK("__new_manifests"."status" IN ('draft', 'billed', 'paid', 'certified', 'cancelled')),
	CONSTRAINT "manifests_quantity_check" CHECK("__new_manifests"."cargo_quantity" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_manifests`("id", "vehicle_id", "origin_city_id", "destination_city_id", "cargo_type", "cargo_quantity", "cargo_unit", "trip_date", "distance_km", "rate_per_km", "trip_cost", "tax_amount", "status", "created_at", "updated_at") SELECT "id", "vehicle_id", "origin_city_id", "destination_city_id", "cargo_type", "cargo_quantity", "cargo_unit", "trip_date", "distance_km", "rate_per_km", "trip_cost", "tax_amount", "status", "created_at", "updated_at" FROM `manifests`;--> statement-breakpoint
DROP TABLE `manifests`;--> statement-breakpoint
ALTER TABLE `__new_manifests` RENAME TO `manifests`;--> statement-breakpoint
CREATE INDEX `manifests_vehicle_id_idx` ON `manifests` (`vehicle_id`);--> statement-breakpoint
CREATE INDEX `manifests_status_idx` ON `manifests` (`status`);