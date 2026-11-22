CREATE TABLE "charge_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "charge_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"charge_id" integer NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_by" integer NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charge_changes_field_check" CHECK ("charge_changes"."field" IN ('created', 'name', 'nameAr', 'cargoValue', 'passengerValue', 'active'))
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "charges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"kind" text NOT NULL,
	"cargo_value" integer,
	"passenger_value" integer,
	"active" boolean DEFAULT true NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "charges_code_unique" UNIQUE("code"),
	CONSTRAINT "charges_kind_check" CHECK ("charges"."kind" IN ('percent', 'fixed')),
	CONSTRAINT "charges_value_check" CHECK (("charges"."kind" = 'percent' AND coalesce("charges"."cargo_value", 0) BETWEEN 0 AND 10000 AND coalesce("charges"."passenger_value", 0) BETWEEN 0 AND 10000)
        OR ("charges"."kind" = 'fixed' AND coalesce("charges"."cargo_value", 0) BETWEEN 0 AND 1000000 AND coalesce("charges"."passenger_value", 0) BETWEEN 0 AND 1000000))
);
--> statement-breakpoint
CREATE TABLE "manifest_charges" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manifest_charges_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"manifest_id" integer NOT NULL,
	"position" integer NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"rate_bps" integer,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "pricing_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"rate_per_km" integer NOT NULL,
	"unit" text NOT NULL,
	"per_quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rates_code_unique" UNIQUE("code"),
	CONSTRAINT "pricing_rates_code_check" CHECK ("pricing_rates"."code" IN ('fuel', 'liquids', 'containers', 'general_cargo', 'passenger')),
	CONSTRAINT "pricing_rates_unit_check" CHECK ("pricing_rates"."unit" IN ('ton', 'liter', 'seat')),
	CONSTRAINT "pricing_rates_rate_check" CHECK ("pricing_rates"."rate_per_km" >= 0 AND "pricing_rates"."per_quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "charge_changes" ADD CONSTRAINT "charge_changes_charge_id_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "public"."charges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charge_changes" ADD CONSTRAINT "charge_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_charges" ADD CONSTRAINT "manifest_charges_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "manifest_charges_manifest_code_idx" ON "manifest_charges" USING btree ("manifest_id","code");--> statement-breakpoint
-- The cargo rates move to pricing_rates, with the development formula's ticket rate: 80 SDG per km
-- per seat (Khartoum to Port Sudan, about 875 km by the estimate, is about 70,000 SDG)
INSERT INTO "pricing_rates" ("code", "rate_per_km", "unit", "per_quantity")
SELECT "cargo_type", "rate_per_km", "unit", "per_quantity" FROM "tax_rates";--> statement-breakpoint
INSERT INTO "pricing_rates" ("code", "rate_per_km", "unit", "per_quantity") VALUES ('passenger', 80, 'seat', 1);--> statement-breakpoint
-- The four built-in charges, at their current values, for cargo and (the same) for passengers
INSERT INTO "charges" ("code", "name", "name_ar", "kind", "cargo_value", "passenger_value", "builtin", "sort")
SELECT s."code", b."name", b."name_ar", b."kind",
  coalesce(s."rate_bps", s."amount"), coalesce(s."rate_bps", s."amount"), true, b."sort"
FROM "tax_settings" s
JOIN (VALUES
  ('vat', 'Value added tax', 'ضريبة القيمة المضافة', 'percent', 1),
  ('business_profit', 'Business profit tax', 'ضريبة أرباح الأعمال', 'percent', 2),
  ('locality', 'Locality tax', 'الضريبة المحلية', 'percent', 3),
  ('manifest_fee', 'Manifest fee', 'رسوم المنفيست', 'fixed', 4)
) AS b("code", "name", "name_ar", "kind", "sort") ON b."code" = s."code";--> statement-breakpoint
-- Bills keep their lines, now with the names they were issued under
INSERT INTO "manifest_charges" ("manifest_id", "position", "code", "name", "name_ar", "rate_bps", "amount", "created_at", "updated_at")
SELECT t."manifest_id", c."sort" - 1, t."code", c."name", c."name_ar", t."rate_bps", t."amount", t."created_at", t."updated_at"
FROM "manifest_taxes" t
JOIN "charges" c ON c."code" = t."code";--> statement-breakpoint
-- The change log: every earlier change was to a cargo value (passenger trips didn't exist)
INSERT INTO "charge_changes" ("charge_id", "field", "old_value", "new_value", "changed_by", "changed_at")
SELECT c."id", 'cargoValue', t."old_value"::text, t."new_value"::text, t."changed_by", t."changed_at"
FROM "tax_setting_changes" t
JOIN "charges" c ON c."code" = t."code";
