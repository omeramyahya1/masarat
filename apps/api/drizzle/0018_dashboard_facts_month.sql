CREATE TABLE "dashboard_facts_month" (
	"day" date NOT NULL,
	"kind" text NOT NULL,
	"origin_city_id" integer,
	"destination_city_id" integer,
	"category" text,
	"trip_kind" text,
	"vehicle_type" text,
	"cargo_type" text,
	"key" text DEFAULT '' NOT NULL,
	"name" text,
	"name_ar" text,
	"value" double precision DEFAULT 0 NOT NULL,
	"n" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "dashboard_facts_month_kind_check" CHECK ("dashboard_facts_month"."kind" IN ('paid', 'cargo', 'charge', 'company', 'status', 'billed', 'billed_paid', 'certificates'))
);
--> statement-breakpoint
CREATE INDEX "dashboard_facts_month_kind_day_idx" ON "dashboard_facts_month" USING btree ("kind","day");