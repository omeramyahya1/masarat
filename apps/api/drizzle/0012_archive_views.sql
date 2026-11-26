-- Live and archived trips together, for reads: each all_* view is the live table UNION ALL its
-- archive twin. The columns are listed by name: after its migrations a live table's columns may
-- sit in another order, so SELECT * wouldn't line them up. Postgres pushes a query's conditions
-- into both halves, so each reads its own indexes. A migration that changes a trip table's
-- columns must change both tables and recreate its view.
CREATE VIEW "all_manifests" AS
  SELECT "id", "vehicle_id", "company_id", "branch_id", "created_by", "origin_city_id", "destination_city_id", "category", "cargo_type", "cargo_quantity", "cargo_unit", "departure_at", "arrival_at", "distance_km", "rate_per_km", "ticket_price", "trip_cost", "tax_amount", "status", "trip_kind", "driver_id", "driver_name", "driver_phone", "shipper_name", "shipper_address", "shipper_phone", "receiver_name", "receiver_address", "receiver_phone", "carrier_name", "carrier_address", "carrier_tin", "created_at", "updated_at"
  FROM "public"."manifests"
  UNION ALL
  SELECT "id", "vehicle_id", "company_id", "branch_id", "created_by", "origin_city_id", "destination_city_id", "category", "cargo_type", "cargo_quantity", "cargo_unit", "departure_at", "arrival_at", "distance_km", "rate_per_km", "ticket_price", "trip_cost", "tax_amount", "status", "trip_kind", "driver_id", "driver_name", "driver_phone", "shipper_name", "shipper_address", "shipper_phone", "receiver_name", "receiver_address", "receiver_phone", "carrier_name", "carrier_address", "carrier_tin", "created_at", "updated_at"
  FROM "archive"."manifests";--> statement-breakpoint
CREATE VIEW "all_manifest_cargo_items" AS
  SELECT "id", "manifest_id", "position", "name", "quantity", "unit", "cargo_type", "rate_per_km", "per_quantity", "cost", "packing_type", "package_count", "notes", "created_at", "updated_at"
  FROM "public"."manifest_cargo_items"
  UNION ALL
  SELECT "id", "manifest_id", "position", "name", "quantity", "unit", "cargo_type", "rate_per_km", "per_quantity", "cost", "packing_type", "package_count", "notes", "created_at", "updated_at"
  FROM "archive"."manifest_cargo_items";--> statement-breakpoint
CREATE VIEW "all_manifest_trailers" AS
  SELECT "id", "manifest_id", "position", "plate_number", "created_at", "updated_at"
  FROM "public"."manifest_trailers"
  UNION ALL
  SELECT "id", "manifest_id", "position", "plate_number", "created_at", "updated_at"
  FROM "archive"."manifest_trailers";--> statement-breakpoint
CREATE VIEW "all_trip_passengers" AS
  SELECT "id", "manifest_id", "position", "full_name", "person_id", "seat_no", "is_infant", "notes", "created_at", "updated_at"
  FROM "public"."trip_passengers"
  UNION ALL
  SELECT "id", "manifest_id", "position", "full_name", "person_id", "seat_no", "is_infant", "notes", "created_at", "updated_at"
  FROM "archive"."trip_passengers";--> statement-breakpoint
CREATE VIEW "all_trip_documents" AS
  SELECT "id", "manifest_id", "doc_type", "file_name", "stored_name", "size", "created_at", "updated_at"
  FROM "public"."trip_documents"
  UNION ALL
  SELECT "id", "manifest_id", "doc_type", "file_name", "stored_name", "size", "created_at", "updated_at"
  FROM "archive"."trip_documents";--> statement-breakpoint
CREATE VIEW "all_manifest_charges" AS
  SELECT "id", "manifest_id", "position", "code", "name", "name_ar", "rate_bps", "amount", "created_at", "updated_at"
  FROM "public"."manifest_charges"
  UNION ALL
  SELECT "id", "manifest_id", "position", "code", "name", "name_ar", "rate_bps", "amount", "created_at", "updated_at"
  FROM "archive"."manifest_charges";--> statement-breakpoint
CREATE VIEW "all_payments" AS
  SELECT "id", "manifest_id", "bill_id", "amount", "currency", "status", "bank", "payment_ref", "paid_at", "created_at", "updated_at"
  FROM "public"."payments"
  UNION ALL
  SELECT "id", "manifest_id", "bill_id", "amount", "currency", "status", "bank", "payment_ref", "paid_at", "created_at", "updated_at"
  FROM "archive"."payments";--> statement-breakpoint
CREATE VIEW "all_certificates" AS
  SELECT "id", "manifest_id", "certificate_no", "manifest_no", "qr_token", "issued_at", "valid_until", "created_at", "updated_at"
  FROM "public"."certificates"
  UNION ALL
  SELECT "id", "manifest_id", "certificate_no", "manifest_no", "qr_token", "issued_at", "valid_until", "created_at", "updated_at"
  FROM "archive"."certificates";--> statement-breakpoint
-- The API's role reads the views and moves trips into the archive (services/archive.ts)
GRANT SELECT ON "all_manifests", "all_manifest_cargo_items", "all_manifest_trailers",
  "all_trip_passengers", "all_trip_documents", "all_manifest_charges", "all_payments",
  "all_certificates" TO masarat_app;--> statement-breakpoint
GRANT USAGE ON SCHEMA "archive" TO masarat_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "archive" TO masarat_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "archive" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO masarat_app;
