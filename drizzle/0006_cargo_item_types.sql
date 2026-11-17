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
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`manifest_id`) REFERENCES `manifests`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "manifest_cargo_items_cargo_type_check" CHECK("__new_manifest_cargo_items"."cargo_type" IN ('fuel', 'liquids', 'containers', 'general_cargo')),
	CONSTRAINT "manifest_cargo_items_unit_check" CHECK("__new_manifest_cargo_items"."unit" IN ('kg', 'ton', 'liter', 'm3')),
	CONSTRAINT "manifest_cargo_items_quantity_check" CHECK("__new_manifest_cargo_items"."quantity" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_manifest_cargo_items`("id", "manifest_id", "position", "name", "quantity", "unit", "cargo_type", "rate_per_km", "per_quantity", "cost", "created_at", "updated_at")
SELECT i."id", i."manifest_id", i."position", i."name", i."quantity", i."unit", m."cargo_type", m."rate_per_km", r."per_quantity",
  CAST(ROUND(m."rate_per_km" * m."distance_km"
    * (CASE i."unit" WHEN 'kg' THEN i."quantity" / 1000.0 WHEN 'm3' THEN i."quantity" * 1000.0 ELSE i."quantity" END)
    / r."per_quantity") AS INTEGER),
  i."created_at", i."updated_at"
FROM `manifest_cargo_items` i
JOIN `manifests` m ON m."id" = i."manifest_id"
JOIN `tax_rates` r ON r."cargo_type" = m."cargo_type";--> statement-breakpoint
DROP TABLE `manifest_cargo_items`;--> statement-breakpoint
ALTER TABLE `__new_manifest_cargo_items` RENAME TO `manifest_cargo_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `manifest_cargo_items_manifest_id_idx` ON `manifest_cargo_items` (`manifest_id`);