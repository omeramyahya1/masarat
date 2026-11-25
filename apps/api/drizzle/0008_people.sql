-- A name as the company search compares it: trimmed, single spaces, lower case, the Arabic
-- spelling variants made one (أ إ آ → ا, ة → ه, ى → ي), and tatweel and diacritics removed.
-- Companies only find whole names: masarat_name_key(column) = masarat_name_key(the text).
CREATE OR REPLACE FUNCTION masarat_name_key(name text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE RETURNS NULL ON NULL INPUT AS $$
  SELECT nullif(btrim(regexp_replace(
    translate(lower(regexp_replace(name, '[ً-ٰٟـ]', '', 'g')), 'أإآةى', 'اااهي'),
    '\s+', ' ', 'g')), '')
$$;--> statement-breakpoint
CREATE TABLE "people" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "people_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"id_type" text NOT NULL,
	"id_number" text NOT NULL,
	"full_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_id_type_check" CHECK ("people"."id_type" IN ('national_id', 'passport'))
);
--> statement-breakpoint
-- Everyone who travelled with an ID, once, under the name of their latest booking
INSERT INTO "people" ("id_type", "id_number", "full_name", "created_at", "updated_at")
SELECT DISTINCT ON ("id_type", "id_number") "id_type", "id_number", "full_name", "created_at", "updated_at"
FROM "trip_passengers"
WHERE "id_number" IS NOT NULL
ORDER BY "id_type", "id_number", "id" DESC;--> statement-breakpoint
CREATE UNIQUE INDEX "people_id_idx" ON "people" USING btree ("id_type","id_number");--> statement-breakpoint
CREATE INDEX "people_id_number_idx" ON "people" USING btree ("id_number");--> statement-breakpoint
-- Each trip's passenger linked to the person (the name as booked stays on the trip)
ALTER TABLE "trip_passengers" ADD COLUMN "person_id" integer;--> statement-breakpoint
UPDATE "trip_passengers" tp SET "person_id" = p."id"
FROM "people" p
WHERE p."id_type" = tp."id_type" AND p."id_number" = tp."id_number";--> statement-breakpoint
ALTER TABLE "trip_passengers" ADD CONSTRAINT "trip_passengers_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_passengers_person_id_idx" ON "trip_passengers" USING btree ("person_id");--> statement-breakpoint
-- The dashboard's counts, answered from the indexes alone
DROP INDEX "manifests_created_at_idx";--> statement-breakpoint
CREATE INDEX "manifests_created_status_idx" ON "manifests" USING btree ("created_at","status");--> statement-breakpoint
CREATE INDEX "payments_created_status_amount_idx" ON "payments" USING btree ("created_at","status","amount");--> statement-breakpoint
CREATE INDEX "payments_pending_idx" ON "payments" USING btree ("manifest_id","amount") WHERE "payments"."status" = 'pending';
