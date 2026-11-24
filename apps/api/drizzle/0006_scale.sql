-- Substring search on names (gin_trgm_ops indexes below)
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "daily_revenue" (
	"day" date NOT NULL,
	"dimension" text NOT NULL,
	"key" text NOT NULL,
	"name" text,
	"name_ar" text,
	"revenue" double precision NOT NULL,
	"trips" integer NOT NULL,
	CONSTRAINT "daily_revenue_day_dimension_key_pk" PRIMARY KEY("day","dimension","key"),
	CONSTRAINT "daily_revenue_dimension_check" CHECK ("daily_revenue"."dimension" IN ('total', 'category', 'cargo', 'charge', 'route', 'origin_state', 'destination_state', 'company', 'vehicle_type', 'trip_kind'))
);
--> statement-breakpoint
DROP INDEX "manifests_branch_id_idx";--> statement-breakpoint
-- The vehicle's company, kept on the trip: added, filled from the vehicles, then required
ALTER TABLE "manifests" ADD COLUMN "company_id" integer;--> statement-breakpoint
UPDATE "manifests" m SET "company_id" = v."company_id" FROM "vehicles" v WHERE v."id" = m."vehicle_id";--> statement-breakpoint
ALTER TABLE "manifests" ALTER COLUMN "company_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificates_issued_at_idx" ON "certificates" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "certificates_valid_until_idx" ON "certificates" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "certificates_manifest_no_pattern_idx" ON "certificates" USING btree ("manifest_no" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "certificates_certificate_no_pattern_idx" ON "certificates" USING btree ("certificate_no" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "manifests_company_departure_idx" ON "manifests" USING btree ("company_id","departure_at");--> statement-breakpoint
CREATE INDEX "manifests_branch_departure_idx" ON "manifests" USING btree ("branch_id","departure_at");--> statement-breakpoint
CREATE INDEX "manifests_driver_id_idx" ON "manifests" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "manifests_created_at_idx" ON "manifests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "manifests_shipper_name_trgm_idx" ON "manifests" USING gin ("shipper_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "manifests_receiver_name_trgm_idx" ON "manifests" USING gin ("receiver_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "manifests_driver_name_trgm_idx" ON "manifests" USING gin ("driver_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "payments_status_paid_at_idx" ON "payments" USING btree ("status","paid_at");--> statement-breakpoint
CREATE INDEX "payments_created_at_idx" ON "payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payments_bill_id_pattern_idx" ON "payments" USING btree ("bill_id" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "vehicles_registration_no_trgm_idx" ON "vehicles" USING gin ("registration_no" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "vehicles_plate_key_trgm_idx" ON "vehicles" USING gin ((replace(replace(upper("plate_number"), ' ', ''), '/', '')) gin_trgm_ops);--> statement-breakpoint
-- The daily revenue summary, filled from every paid bill so far (services/dailyRevenue.ts runs the
-- same statement). Days are Sudan days: the migration's session runs on the API's time zone.
WITH paid AS (
  SELECT p.manifest_id, p.amount, p.paid_at::date AS day, m.category, m.cargo_type,
         m.origin_city_id, m.destination_city_id, m.company_id, m.trip_kind, v.vehicle_type,
         os.name AS origin_state, ds.name AS destination_state
  FROM payments p
  JOIN manifests m ON m.id = p.manifest_id
  JOIN vehicles v ON v.id = m.vehicle_id
  JOIN cities oc ON oc.id = m.origin_city_id
  JOIN states os ON os.id = oc.state_id
  JOIN cities dc ON dc.id = m.destination_city_id
  JOIN states ds ON ds.id = dc.state_id
  WHERE p.status = 'paid' AND p.paid_at IS NOT NULL AND true
),
items AS (
  SELECT i.manifest_id, i.cargo_type, i.cost
  FROM manifest_cargo_items i JOIN paid ON paid.manifest_id = i.manifest_id
),
item_cost AS (
  SELECT manifest_id, sum(cost) AS cost FROM items GROUP BY manifest_id
),
cargo_shares AS (
  SELECT paid.day, items.cargo_type AS key,
         paid.amount::float8 * items.cost / item_cost.cost AS revenue, paid.manifest_id
  FROM paid
  JOIN items ON items.manifest_id = paid.manifest_id
  JOIN item_cost ON item_cost.manifest_id = paid.manifest_id
  WHERE item_cost.cost > 0
  UNION ALL
  SELECT paid.day, coalesce(paid.cargo_type, 'passengers'), paid.amount::float8, paid.manifest_id
  FROM paid LEFT JOIN item_cost ON item_cost.manifest_id = paid.manifest_id
  WHERE coalesce(item_cost.cost, 0) <= 0
),
rows AS (
  SELECT day, 'total' AS dimension, '' AS key, NULL::text AS name, NULL::text AS name_ar,
         sum(amount)::float8 AS revenue, count(*)::int AS trips
  FROM paid GROUP BY day
  UNION ALL
  SELECT day, 'category', category, NULL, NULL, sum(amount), count(*) FROM paid GROUP BY day, category
  UNION ALL
  SELECT day, 'route', origin_city_id || '-' || destination_city_id, NULL, NULL, sum(amount), count(*)
  FROM paid GROUP BY day, origin_city_id, destination_city_id
  UNION ALL
  SELECT day, 'origin_state', origin_state, NULL, NULL, sum(amount), count(*) FROM paid GROUP BY day, origin_state
  UNION ALL
  SELECT day, 'destination_state', destination_state, NULL, NULL, sum(amount), count(*)
  FROM paid GROUP BY day, destination_state
  UNION ALL
  SELECT day, 'company', company_id::text, NULL, NULL, sum(amount), count(*) FROM paid GROUP BY day, company_id
  UNION ALL
  SELECT day, 'vehicle_type', vehicle_type, NULL, NULL, sum(amount), count(*) FROM paid GROUP BY day, vehicle_type
  UNION ALL
  SELECT day, 'trip_kind', trip_kind, NULL, NULL, sum(amount), count(*) FROM paid GROUP BY day, trip_kind
  UNION ALL
  SELECT day, 'cargo', key, NULL, NULL, sum(revenue), count(DISTINCT manifest_id)::int
  FROM cargo_shares GROUP BY day, key
  UNION ALL
  SELECT paid.day, 'charge', c.code,
         (array_agg(c.name ORDER BY c.id DESC))[1], (array_agg(c.name_ar ORDER BY c.id DESC))[1],
         sum(c.amount), count(*)
  FROM paid JOIN manifest_charges c ON c.manifest_id = paid.manifest_id
  GROUP BY paid.day, c.code
)
INSERT INTO daily_revenue (day, dimension, key, name, name_ar, revenue, trips)
SELECT day, dimension, key, name, name_ar, revenue, trips FROM rows
ON CONFLICT (day, dimension, key) DO UPDATE SET
  revenue = daily_revenue.revenue + EXCLUDED.revenue,
  trips = daily_revenue.trips + EXCLUDED.trips,
  name = coalesce(EXCLUDED.name, daily_revenue.name),
  name_ar = coalesce(EXCLUDED.name_ar, daily_revenue.name_ar);
