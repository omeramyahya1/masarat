CREATE SCHEMA "archive";
--> statement-breakpoint
CREATE TABLE "archive"."certificates" (
	"id" integer PRIMARY KEY NOT NULL,
	"manifest_id" integer NOT NULL,
	"certificate_no" text NOT NULL,
	"manifest_no" text NOT NULL,
	"qr_token" text NOT NULL,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "certificates_manifest_id_unique" UNIQUE("manifest_id"),
	CONSTRAINT "certificates_certificate_no_unique" UNIQUE("certificate_no"),
	CONSTRAINT "certificates_manifest_no_unique" UNIQUE("manifest_no"),
	CONSTRAINT "certificates_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE TABLE "archive"."manifest_cargo_items" (
	"id" integer PRIMARY KEY NOT NULL,
	"manifest_id" integer NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"quantity" double precision NOT NULL,
	"unit" text NOT NULL,
	"cargo_type" text NOT NULL,
	"rate_per_km" integer NOT NULL,
	"per_quantity" integer NOT NULL,
	"cost" integer NOT NULL,
	"packing_type" text,
	"package_count" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifest_cargo_items_cargo_type_check" CHECK ("archive"."manifest_cargo_items"."cargo_type" IN ('fuel', 'liquids', 'containers', 'general_cargo')),
	CONSTRAINT "manifest_cargo_items_unit_check" CHECK ("archive"."manifest_cargo_items"."unit" IN ('kg', 'ton', 'liter', 'm3')),
	CONSTRAINT "manifest_cargo_items_package_count_check" CHECK ("archive"."manifest_cargo_items"."package_count" IS NULL OR "archive"."manifest_cargo_items"."package_count" > 0),
	CONSTRAINT "manifest_cargo_items_quantity_check" CHECK ("archive"."manifest_cargo_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "archive"."manifest_charges" (
	"id" integer PRIMARY KEY NOT NULL,
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
CREATE TABLE "archive"."manifest_trailers" (
	"id" integer PRIMARY KEY NOT NULL,
	"manifest_id" integer NOT NULL,
	"position" integer NOT NULL,
	"plate_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "archive"."manifests" (
	"id" integer PRIMARY KEY NOT NULL,
	"vehicle_id" integer NOT NULL,
	"company_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"created_by" integer,
	"origin_city_id" integer NOT NULL,
	"destination_city_id" integer NOT NULL,
	"category" text DEFAULT 'cargo' NOT NULL,
	"cargo_type" text,
	"cargo_quantity" double precision NOT NULL,
	"cargo_unit" text NOT NULL,
	"departure_at" timestamp with time zone NOT NULL,
	"arrival_at" timestamp with time zone NOT NULL,
	"distance_km" double precision NOT NULL,
	"rate_per_km" integer NOT NULL,
	"ticket_price" integer,
	"trip_cost" integer NOT NULL,
	"tax_amount" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"trip_kind" text DEFAULT 'domestic' NOT NULL,
	"driver_id" integer,
	"driver_name" text,
	"driver_phone" text,
	"shipper_name" text,
	"shipper_address" text,
	"shipper_phone" text,
	"receiver_name" text,
	"receiver_address" text,
	"receiver_phone" text,
	"carrier_name" text,
	"carrier_address" text,
	"carrier_tin" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifests_trip_kind_check" CHECK ("archive"."manifests"."trip_kind" IN ('domestic', 'import', 'export')),
	CONSTRAINT "manifests_route_check" CHECK ("archive"."manifests"."origin_city_id" <> "archive"."manifests"."destination_city_id"),
	CONSTRAINT "manifests_category_check" CHECK ("archive"."manifests"."category" IN ('cargo', 'passenger')),
	CONSTRAINT "manifests_cargo_type_check" CHECK ("archive"."manifests"."category" = 'cargo' AND "archive"."manifests"."cargo_type" IN ('fuel', 'liquids', 'containers', 'general_cargo')
        OR "archive"."manifests"."category" = 'passenger' AND "archive"."manifests"."cargo_type" IS NULL AND "archive"."manifests"."cargo_unit" = 'seat'),
	CONSTRAINT "manifests_unit_check" CHECK ("archive"."manifests"."cargo_unit" IN ('ton', 'liter', 'seat')),
	CONSTRAINT "manifests_status_check" CHECK ("archive"."manifests"."status" IN ('draft', 'billed', 'paid', 'certified', 'cancelled')),
	CONSTRAINT "manifests_quantity_check" CHECK ("archive"."manifests"."cargo_quantity" > 0 OR "archive"."manifests"."category" = 'passenger' AND "archive"."manifests"."cargo_quantity" >= 0),
	CONSTRAINT "manifests_arrival_check" CHECK ("archive"."manifests"."arrival_at" > "archive"."manifests"."departure_at")
);
--> statement-breakpoint
CREATE TABLE "archive"."payments" (
	"id" integer PRIMARY KEY NOT NULL,
	"manifest_id" integer NOT NULL,
	"bill_id" text NOT NULL,
	"amount" integer NOT NULL,
	"currency" text DEFAULT 'SDG' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"bank" text,
	"payment_ref" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_manifest_id_unique" UNIQUE("manifest_id"),
	CONSTRAINT "payments_bill_id_unique" UNIQUE("bill_id"),
	CONSTRAINT "payments_payment_ref_unique" UNIQUE("payment_ref"),
	CONSTRAINT "payments_status_check" CHECK ("archive"."payments"."status" IN ('pending', 'paid', 'expired', 'failed')),
	CONSTRAINT "payments_amount_check" CHECK ("archive"."payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "archive"."trip_documents" (
	"id" integer PRIMARY KEY NOT NULL,
	"manifest_id" integer NOT NULL,
	"doc_type" text NOT NULL,
	"file_name" text NOT NULL,
	"stored_name" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_documents_type_check" CHECK ("archive"."trip_documents"."doc_type" IN ('commercial_invoice', 'packing_list', 'certificate_of_origin', 'trade_authorization'))
);
--> statement-breakpoint
CREATE TABLE "archive"."trip_passengers" (
	"id" integer PRIMARY KEY NOT NULL,
	"manifest_id" integer NOT NULL,
	"position" integer NOT NULL,
	"full_name" text NOT NULL,
	"person_id" integer,
	"seat_no" integer NOT NULL,
	"is_infant" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_passengers_seat_check" CHECK ("archive"."trip_passengers"."seat_no" > 0)
);
--> statement-breakpoint
ALTER TABLE "archive"."certificates" ADD CONSTRAINT "certificates_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "archive"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."manifest_cargo_items" ADD CONSTRAINT "manifest_cargo_items_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "archive"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."manifest_charges" ADD CONSTRAINT "manifest_charges_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "archive"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."manifest_trailers" ADD CONSTRAINT "manifest_trailers_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "archive"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."manifests" ADD CONSTRAINT "manifests_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."manifests" ADD CONSTRAINT "manifests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."manifests" ADD CONSTRAINT "manifests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."manifests" ADD CONSTRAINT "manifests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."manifests" ADD CONSTRAINT "manifests_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."manifests" ADD CONSTRAINT "manifests_destination_city_id_cities_id_fk" FOREIGN KEY ("destination_city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."manifests" ADD CONSTRAINT "manifests_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."payments" ADD CONSTRAINT "payments_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "archive"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."trip_documents" ADD CONSTRAINT "trip_documents_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "archive"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."trip_passengers" ADD CONSTRAINT "trip_passengers_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "archive"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "archive"."trip_passengers" ADD CONSTRAINT "trip_passengers_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "certificates_issued_at_idx" ON "archive"."certificates" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "certificates_valid_until_idx" ON "archive"."certificates" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "certificates_manifest_no_pattern_idx" ON "archive"."certificates" USING btree ("manifest_no" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "certificates_certificate_no_pattern_idx" ON "archive"."certificates" USING btree ("certificate_no" text_pattern_ops);--> statement-breakpoint
CREATE INDEX "manifest_cargo_items_manifest_id_idx" ON "archive"."manifest_cargo_items" USING btree ("manifest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manifest_charges_manifest_code_idx" ON "archive"."manifest_charges" USING btree ("manifest_id","code");--> statement-breakpoint
CREATE INDEX "manifest_trailers_manifest_id_idx" ON "archive"."manifest_trailers" USING btree ("manifest_id");--> statement-breakpoint
CREATE INDEX "manifests_vehicle_id_idx" ON "archive"."manifests" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "manifests_company_departure_idx" ON "archive"."manifests" USING btree ("company_id","departure_at");--> statement-breakpoint
CREATE INDEX "manifests_branch_departure_idx" ON "archive"."manifests" USING btree ("branch_id","departure_at");--> statement-breakpoint
CREATE INDEX "manifests_origin_departure_idx" ON "archive"."manifests" USING btree ("origin_city_id","departure_at");--> statement-breakpoint
CREATE INDEX "manifests_destination_departure_idx" ON "archive"."manifests" USING btree ("destination_city_id","departure_at");--> statement-breakpoint
CREATE INDEX "manifests_driver_id_idx" ON "archive"."manifests" USING btree ("driver_id");--> statement-breakpoint
CREATE INDEX "manifests_created_status_idx" ON "archive"."manifests" USING btree ("created_at","status");--> statement-breakpoint
CREATE INDEX "manifests_shipper_name_trgm_idx" ON "archive"."manifests" USING gin ("shipper_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "manifests_receiver_name_trgm_idx" ON "archive"."manifests" USING gin ("receiver_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "manifests_driver_name_trgm_idx" ON "archive"."manifests" USING gin ("driver_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "manifests_status_idx" ON "archive"."manifests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "manifests_departure_at_idx" ON "archive"."manifests" USING btree ("departure_at");--> statement-breakpoint
CREATE INDEX "payments_status_paid_at_idx" ON "archive"."payments" USING btree ("status","paid_at");--> statement-breakpoint
CREATE INDEX "payments_created_at_idx" ON "archive"."payments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "payments_created_status_amount_idx" ON "archive"."payments" USING btree ("created_at","status","amount");--> statement-breakpoint
CREATE INDEX "payments_pending_idx" ON "archive"."payments" USING btree ("manifest_id","amount") WHERE "archive"."payments"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "payments_bill_id_pattern_idx" ON "archive"."payments" USING btree ("bill_id" text_pattern_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "trip_documents_manifest_type_idx" ON "archive"."trip_documents" USING btree ("manifest_id","doc_type");--> statement-breakpoint
CREATE INDEX "trip_passengers_manifest_id_idx" ON "archive"."trip_passengers" USING btree ("manifest_id");--> statement-breakpoint
CREATE INDEX "trip_passengers_person_id_idx" ON "archive"."trip_passengers" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_passengers_seat_idx" ON "archive"."trip_passengers" USING btree ("manifest_id","seat_no") WHERE NOT "archive"."trip_passengers"."is_infant";