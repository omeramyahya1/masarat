-- Passenger trips (buses), departure and arrival times for every trip, trip templates and the
-- government's settings
CREATE TABLE "system_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_passengers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_passengers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"manifest_id" integer NOT NULL,
	"position" integer NOT NULL,
	"full_name" text NOT NULL,
	"id_type" text,
	"id_number" text,
	"seat_no" integer NOT NULL,
	"is_infant" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_passengers_id_type_check" CHECK ("trip_passengers"."id_type" IS NULL OR "trip_passengers"."id_type" IN ('national_id', 'passport')),
	CONSTRAINT "trip_passengers_id_check" CHECK (("trip_passengers"."id_type" IS NULL) = ("trip_passengers"."id_number" IS NULL)),
	CONSTRAINT "trip_passengers_seat_check" CHECK ("trip_passengers"."seat_no" > 0)
);
--> statement-breakpoint
CREATE TABLE "trip_templates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_templates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"name" text NOT NULL,
	"origin_city_id" integer NOT NULL,
	"destination_city_id" integer NOT NULL,
	"vehicle_id" integer NOT NULL,
	"driver_id" integer,
	"departure_time" text NOT NULL,
	"duration_minutes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_templates_route_check" CHECK ("trip_templates"."origin_city_id" <> "trip_templates"."destination_city_id"),
	CONSTRAINT "trip_templates_duration_check" CHECK ("trip_templates"."duration_minutes" > 0)
);
--> statement-breakpoint
ALTER TABLE "manifests" DROP CONSTRAINT "manifests_cargo_type_check";--> statement-breakpoint
ALTER TABLE "manifests" DROP CONSTRAINT "manifests_unit_check";--> statement-breakpoint
ALTER TABLE "manifests" DROP CONSTRAINT "manifests_quantity_check";--> statement-breakpoint
ALTER TABLE "role_permissions" DROP CONSTRAINT "role_permissions_permission_check";--> statement-breakpoint
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_type_check";--> statement-breakpoint
ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_unit_check";--> statement-breakpoint
ALTER TABLE "manifests" ALTER COLUMN "cargo_type" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "manifests" ADD COLUMN "category" text DEFAULT 'cargo' NOT NULL;--> statement-breakpoint
ALTER TABLE "manifests" ADD COLUMN "departure_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "manifests" ADD COLUMN "arrival_at" timestamp with time zone;--> statement-breakpoint
-- Existing trips leave at their trip date (local midnight), and arrive after their distance at the
-- trucks' default average speed of 50 km/h (at least an hour later)
UPDATE "manifests" SET
  "departure_at" = "trip_date",
  "arrival_at" = "trip_date" + greatest(interval '1 hour', make_interval(secs => "distance_km" / 50 * 3600));--> statement-breakpoint
ALTER TABLE "manifests" ALTER COLUMN "departure_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "manifests" ALTER COLUMN "arrival_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "manifests" ADD COLUMN "ticket_price" integer;--> statement-breakpoint
ALTER TABLE "trip_passengers" ADD CONSTRAINT "trip_passengers_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_templates" ADD CONSTRAINT "trip_templates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_templates" ADD CONSTRAINT "trip_templates_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_templates" ADD CONSTRAINT "trip_templates_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_templates" ADD CONSTRAINT "trip_templates_destination_city_id_cities_id_fk" FOREIGN KEY ("destination_city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_templates" ADD CONSTRAINT "trip_templates_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_templates" ADD CONSTRAINT "trip_templates_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_passengers_manifest_id_idx" ON "trip_passengers" USING btree ("manifest_id");--> statement-breakpoint
CREATE INDEX "trip_passengers_id_number_idx" ON "trip_passengers" USING btree ("id_number");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_passengers_seat_idx" ON "trip_passengers" USING btree ("manifest_id","seat_no") WHERE NOT "trip_passengers"."is_infant";--> statement-breakpoint
CREATE INDEX "trip_templates_company_id_idx" ON "trip_templates" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "manifests_departure_at_idx" ON "manifests" USING btree ("departure_at");--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_category_check" CHECK ("manifests"."category" IN ('cargo', 'passenger'));--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_arrival_check" CHECK ("manifests"."arrival_at" > "manifests"."departure_at");--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_cargo_type_check" CHECK ("manifests"."category" = 'cargo' AND "manifests"."cargo_type" IN ('fuel', 'liquids', 'containers', 'general_cargo')
        OR "manifests"."category" = 'passenger' AND "manifests"."cargo_type" IS NULL AND "manifests"."cargo_unit" = 'seat');--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_unit_check" CHECK ("manifests"."cargo_unit" IN ('ton', 'liter', 'seat'));--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_quantity_check" CHECK ("manifests"."cargo_quantity" > 0 OR "manifests"."category" = 'passenger' AND "manifests"."cargo_quantity" >= 0);--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_check" CHECK ("role_permissions"."permission" IN ('trips.view', 'trips.edit', 'trips.bill', 'templates.use', 'templates.manage', 'fleet.view', 'fleet.manage', 'drivers.view', 'drivers.manage', 'company.profile', 'branches.manage', 'members.manage', 'roles.manage', 'govt.dashboard', 'govt.search', 'govt.exports', 'govt.charges', 'govt.settings', 'govt.users'));--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_bus_seat_check" CHECK (("vehicles"."vehicle_type" = 'bus') = ("vehicles"."capacity_unit" = 'seat'));--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_type_check" CHECK ("vehicles"."vehicle_type" IN ('heavy_duty_truck', 'lorry', 'light_duty_truck', 'jumbo_truck', 'tanker', 'container_truck', 'bus'));--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_unit_check" CHECK ("vehicles"."capacity_unit" IN ('ton', 'liter', 'seat'));--> statement-breakpoint
-- The government's settings, at their defaults (DEFAULT_SETTINGS)
INSERT INTO "system_settings" ("key", "value") VALUES
  ('validity_margin_hours.cargo', 24),
  ('validity_margin_hours.passenger', 24),
  ('average_speed_kmh.cargo', 50),
  ('average_speed_kmh.passenger', 70);--> statement-breakpoint
-- Every company's clerk books trips from templates too (the clerk's new default)
INSERT INTO "role_permissions" ("role_id", "permission")
SELECT "id", 'templates.use' FROM "roles" WHERE "key" = 'clerk'
ON CONFLICT DO NOTHING;