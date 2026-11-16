CREATE TABLE `certificates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manifest_id` integer NOT NULL,
	`certificate_no` text NOT NULL,
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
CREATE UNIQUE INDEX `certificates_qr_token_unique` ON `certificates` (`qr_token`);--> statement-breakpoint
CREATE TABLE `cities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cities_name_unique` ON `cities` (`name`);--> statement-breakpoint
CREATE TABLE `manifests` (
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
	`tax_amount` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`origin_city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`destination_city_id`) REFERENCES `cities`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "manifests_route_check" CHECK("manifests"."origin_city_id" <> "manifests"."destination_city_id"),
	CONSTRAINT "manifests_cargo_type_check" CHECK("manifests"."cargo_type" IN ('fuel', 'containers', 'general_cargo')),
	CONSTRAINT "manifests_unit_check" CHECK("manifests"."cargo_unit" IN ('ton', 'liter')),
	CONSTRAINT "manifests_status_check" CHECK("manifests"."status" IN ('draft', 'billed', 'paid', 'certified', 'cancelled')),
	CONSTRAINT "manifests_quantity_check" CHECK("manifests"."cargo_quantity" > 0)
);
--> statement-breakpoint
CREATE INDEX `manifests_vehicle_id_idx` ON `manifests` (`vehicle_id`);--> statement-breakpoint
CREATE INDEX `manifests_status_idx` ON `manifests` (`status`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manifest_id` integer NOT NULL,
	`bill_id` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'SDG' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`bank` text,
	`payment_ref` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`manifest_id`) REFERENCES `manifests`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "payments_status_check" CHECK("payments"."status" IN ('pending', 'paid', 'expired', 'failed')),
	CONSTRAINT "payments_amount_check" CHECK("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payments_manifest_id_unique` ON `payments` (`manifest_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_bill_id_unique` ON `payments` (`bill_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `payments_payment_ref_unique` ON `payments` (`payment_ref`);--> statement-breakpoint
CREATE TABLE `tax_rates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cargo_type` text NOT NULL,
	`rate_per_km` integer NOT NULL,
	`unit` text NOT NULL,
	`per_quantity` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "tax_rates_cargo_type_check" CHECK("tax_rates"."cargo_type" IN ('fuel', 'containers', 'general_cargo')),
	CONSTRAINT "tax_rates_unit_check" CHECK("tax_rates"."unit" IN ('ton', 'liter'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tax_rates_cargo_type_unique` ON `tax_rates` (`cargo_type`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text NOT NULL,
	`full_name` text NOT NULL,
	`phone` text,
	`company_name` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "users_role_check" CHECK("users"."role" IN ('owner', 'govt'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE TABLE `vehicles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` integer NOT NULL,
	`plate_number` text NOT NULL,
	`vehicle_type` text NOT NULL,
	`capacity` real NOT NULL,
	`capacity_unit` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "vehicles_type_check" CHECK("vehicles"."vehicle_type" IN ('heavy_duty_truck', 'lorry', 'light_duty_truck', 'jumbo_truck', 'tanker', 'container_truck')),
	CONSTRAINT "vehicles_unit_check" CHECK("vehicles"."capacity_unit" IN ('ton', 'liter')),
	CONSTRAINT "vehicles_capacity_check" CHECK("vehicles"."capacity" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_plate_number_unique` ON `vehicles` (`plate_number`);--> statement-breakpoint
CREATE INDEX `vehicles_owner_id_idx` ON `vehicles` (`owner_id`);