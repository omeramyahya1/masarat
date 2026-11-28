-- The names' search keys (masarat_name_key, migration 0008), stored on the live and archive trip
-- tables, so the company trips search compares whole names by a column instead of computing the key
-- for every trip of the period. Adding a stored generated column rewrites its table: on a big
-- database, run this in a maintenance window. A table's keys are added in one statement, so each
-- table is rewritten once.
ALTER TABLE "archive"."manifest_cargo_items" ADD COLUMN "name_key" text GENERATED ALWAYS AS (masarat_name_key(name)) STORED;--> statement-breakpoint
ALTER TABLE "archive"."manifests"
  ADD COLUMN "driver_name_key" text GENERATED ALWAYS AS (masarat_name_key(driver_name)) STORED,
  ADD COLUMN "shipper_name_key" text GENERATED ALWAYS AS (masarat_name_key(shipper_name)) STORED,
  ADD COLUMN "receiver_name_key" text GENERATED ALWAYS AS (masarat_name_key(receiver_name)) STORED;--> statement-breakpoint
ALTER TABLE "archive"."trip_passengers" ADD COLUMN "full_name_key" text GENERATED ALWAYS AS (masarat_name_key(full_name)) STORED;--> statement-breakpoint
ALTER TABLE "manifest_cargo_items" ADD COLUMN "name_key" text GENERATED ALWAYS AS (masarat_name_key(name)) STORED;--> statement-breakpoint
ALTER TABLE "manifests"
  ADD COLUMN "driver_name_key" text GENERATED ALWAYS AS (masarat_name_key(driver_name)) STORED,
  ADD COLUMN "shipper_name_key" text GENERATED ALWAYS AS (masarat_name_key(shipper_name)) STORED,
  ADD COLUMN "receiver_name_key" text GENERATED ALWAYS AS (masarat_name_key(receiver_name)) STORED;--> statement-breakpoint
ALTER TABLE "trip_passengers" ADD COLUMN "full_name_key" text GENERATED ALWAYS AS (masarat_name_key(full_name)) STORED;--> statement-breakpoint
-- The view gains the keys (appended, so CREATE OR REPLACE keeps it and its grants)
CREATE OR REPLACE VIEW "all_manifests" AS
  SELECT "id", "vehicle_id", "company_id", "branch_id", "created_by", "origin_city_id", "destination_city_id", "category", "cargo_type", "cargo_quantity", "cargo_unit", "departure_at", "arrival_at", "distance_km", "rate_per_km", "ticket_price", "trip_cost", "tax_amount", "status", "trip_kind", "driver_id", "driver_name", "driver_phone", "shipper_name", "shipper_address", "shipper_phone", "receiver_name", "receiver_address", "receiver_phone", "carrier_name", "carrier_address", "carrier_tin", "created_at", "updated_at", "driver_name_key", "shipper_name_key", "receiver_name_key"
  FROM "public"."manifests"
  UNION ALL
  SELECT "id", "vehicle_id", "company_id", "branch_id", "created_by", "origin_city_id", "destination_city_id", "category", "cargo_type", "cargo_quantity", "cargo_unit", "departure_at", "arrival_at", "distance_km", "rate_per_km", "ticket_price", "trip_cost", "tax_amount", "status", "trip_kind", "driver_id", "driver_name", "driver_phone", "shipper_name", "shipper_address", "shipper_phone", "receiver_name", "receiver_address", "receiver_phone", "carrier_name", "carrier_address", "carrier_tin", "created_at", "updated_at", "driver_name_key", "shipper_name_key", "receiver_name_key"
  FROM "archive"."manifests";--> statement-breakpoint
-- The view gains the keys (appended, so CREATE OR REPLACE keeps it and its grants)
CREATE OR REPLACE VIEW "all_manifest_cargo_items" AS
  SELECT "id", "manifest_id", "position", "name", "quantity", "unit", "cargo_type", "rate_per_km", "per_quantity", "cost", "packing_type", "package_count", "notes", "created_at", "updated_at", "name_key"
  FROM "public"."manifest_cargo_items"
  UNION ALL
  SELECT "id", "manifest_id", "position", "name", "quantity", "unit", "cargo_type", "rate_per_km", "per_quantity", "cost", "packing_type", "package_count", "notes", "created_at", "updated_at", "name_key"
  FROM "archive"."manifest_cargo_items";--> statement-breakpoint
-- The view gains the keys (appended, so CREATE OR REPLACE keeps it and its grants)
CREATE OR REPLACE VIEW "all_trip_passengers" AS
  SELECT "id", "manifest_id", "position", "full_name", "person_id", "seat_no", "is_infant", "notes", "created_at", "updated_at", "full_name_key"
  FROM "public"."trip_passengers"
  UNION ALL
  SELECT "id", "manifest_id", "position", "full_name", "person_id", "seat_no", "is_infant", "notes", "created_at", "updated_at", "full_name_key"
  FROM "archive"."trip_passengers";
