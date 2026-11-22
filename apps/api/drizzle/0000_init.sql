CREATE TABLE "branches" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "branches_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"city_id" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "certificates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "certificates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
CREATE TABLE "cities" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cities_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"state_id" integer NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cities_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "companies_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"address" text,
	"tin" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "drivers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esali_sim_bills" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "esali_sim_bills_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"bill_id" text NOT NULL,
	"amount" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_ref" text,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "esali_sim_bills_bill_id_unique" UNIQUE("bill_id"),
	CONSTRAINT "esali_sim_bills_payment_ref_unique" UNIQUE("payment_ref"),
	CONSTRAINT "esali_sim_bills_status_check" CHECK ("esali_sim_bills"."status" IN ('pending', 'paid', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" text NOT NULL,
	"ip" text,
	"succeeded" boolean NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifest_cargo_items" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manifest_cargo_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	CONSTRAINT "manifest_cargo_items_cargo_type_check" CHECK ("manifest_cargo_items"."cargo_type" IN ('fuel', 'liquids', 'containers', 'general_cargo')),
	CONSTRAINT "manifest_cargo_items_unit_check" CHECK ("manifest_cargo_items"."unit" IN ('kg', 'ton', 'liter', 'm3')),
	CONSTRAINT "manifest_cargo_items_package_count_check" CHECK ("manifest_cargo_items"."package_count" IS NULL OR "manifest_cargo_items"."package_count" > 0),
	CONSTRAINT "manifest_cargo_items_quantity_check" CHECK ("manifest_cargo_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "manifest_taxes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manifest_taxes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"manifest_id" integer NOT NULL,
	"code" text NOT NULL,
	"rate_bps" integer,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manifest_taxes_code_check" CHECK ("manifest_taxes"."code" IN ('vat', 'business_profit', 'locality', 'manifest_fee'))
);
--> statement-breakpoint
CREATE TABLE "manifest_trailers" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manifest_trailers_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"manifest_id" integer NOT NULL,
	"position" integer NOT NULL,
	"plate_number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "manifests" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "manifests_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"vehicle_id" integer NOT NULL,
	"branch_id" integer NOT NULL,
	"created_by" integer,
	"origin_city_id" integer NOT NULL,
	"destination_city_id" integer NOT NULL,
	"cargo_type" text NOT NULL,
	"cargo_quantity" double precision NOT NULL,
	"cargo_unit" text NOT NULL,
	"trip_date" timestamp with time zone NOT NULL,
	"distance_km" double precision NOT NULL,
	"rate_per_km" integer NOT NULL,
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
	CONSTRAINT "manifests_trip_kind_check" CHECK ("manifests"."trip_kind" IN ('domestic', 'import', 'export')),
	CONSTRAINT "manifests_route_check" CHECK ("manifests"."origin_city_id" <> "manifests"."destination_city_id"),
	CONSTRAINT "manifests_cargo_type_check" CHECK ("manifests"."cargo_type" IN ('fuel', 'liquids', 'containers', 'general_cargo')),
	CONSTRAINT "manifests_unit_check" CHECK ("manifests"."cargo_unit" IN ('ton', 'liter')),
	CONSTRAINT "manifests_status_check" CHECK ("manifests"."status" IN ('draft', 'billed', 'paid', 'certified', 'cancelled')),
	CONSTRAINT "manifests_quantity_check" CHECK ("manifests"."cargo_quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
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
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('pending', 'paid', 'expired', 'failed')),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" integer NOT NULL,
	"permission" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_pk" PRIMARY KEY("role_id","permission"),
	CONSTRAINT "role_permissions_permission_check" CHECK ("role_permissions"."permission" IN ('trips.view', 'trips.edit', 'trips.bill', 'fleet.view', 'fleet.manage', 'drivers.view', 'drivers.manage', 'company.profile', 'branches.manage', 'members.manage', 'roles.manage', 'govt.dashboard', 'govt.search', 'govt.exports', 'govt.charges', 'govt.users'))
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "roles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer,
	"key" text,
	"name" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_company_name_unique" UNIQUE NULLS NOT DISTINCT("company_id","name"),
	CONSTRAINT "roles_key_check" CHECK ("roles"."key" IS NULL OR "roles"."key" IN ('company_admin', 'clerk', 'accountant', 'govt_admin', 'govt_agent')),
	CONSTRAINT "roles_scope_check" CHECK ("roles"."scope" IN ('branch', 'company')),
	CONSTRAINT "roles_govt_check" CHECK ("roles"."company_id" IS NOT NULL OR "roles"."key" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "states" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "states_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"capital_city_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "states_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "tax_rates" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tax_rates_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cargo_type" text NOT NULL,
	"rate_per_km" integer NOT NULL,
	"unit" text NOT NULL,
	"per_quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_rates_cargo_type_unique" UNIQUE("cargo_type"),
	CONSTRAINT "tax_rates_cargo_type_check" CHECK ("tax_rates"."cargo_type" IN ('fuel', 'liquids', 'containers', 'general_cargo')),
	CONSTRAINT "tax_rates_unit_check" CHECK ("tax_rates"."unit" IN ('ton', 'liter'))
);
--> statement-breakpoint
CREATE TABLE "tax_setting_changes" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tax_setting_changes_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"old_value" integer NOT NULL,
	"new_value" integer NOT NULL,
	"changed_by" integer NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_settings" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tax_settings_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"rate_bps" integer,
	"amount" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_settings_code_unique" UNIQUE("code"),
	CONSTRAINT "tax_settings_code_check" CHECK ("tax_settings"."code" IN ('vat', 'business_profit', 'locality', 'manifest_fee')),
	CONSTRAINT "tax_settings_value_check" CHECK (("tax_settings"."code" IN ('vat', 'business_profit', 'locality') AND "tax_settings"."rate_bps" BETWEEN 0 AND 10000 AND "tax_settings"."amount" IS NULL)
        OR ("tax_settings"."code" IN ('manifest_fee') AND "tax_settings"."amount" BETWEEN 0 AND 1000000 AND "tax_settings"."rate_bps" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "trip_documents" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_documents_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"manifest_id" integer NOT NULL,
	"doc_type" text NOT NULL,
	"file_name" text NOT NULL,
	"stored_name" text NOT NULL,
	"size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_documents_type_check" CHECK ("trip_documents"."doc_type" IN ('commercial_invoice', 'packing_list', 'certificate_of_origin', 'trade_authorization'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"kind" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text NOT NULL,
	"company_id" integer,
	"role_id" integer NOT NULL,
	"branch_id" integer,
	"is_demo" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_phone_unique" UNIQUE("phone"),
	CONSTRAINT "users_kind_check" CHECK ("users"."kind" IN ('company', 'govt')),
	CONSTRAINT "users_company_check" CHECK (("users"."kind" = 'company') = ("users"."company_id" IS NOT NULL) AND ("users"."kind" = 'company' OR "users"."branch_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "vehicles_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"company_id" integer NOT NULL,
	"plate_number" text NOT NULL,
	"registration_no" text,
	"vehicle_type" text NOT NULL,
	"capacity" double precision NOT NULL,
	"capacity_unit" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_plate_number_unique" UNIQUE("plate_number"),
	CONSTRAINT "vehicles_type_check" CHECK ("vehicles"."vehicle_type" IN ('heavy_duty_truck', 'lorry', 'light_duty_truck', 'jumbo_truck', 'tanker', 'container_truck')),
	CONSTRAINT "vehicles_unit_check" CHECK ("vehicles"."capacity_unit" IN ('ton', 'liter')),
	CONSTRAINT "vehicles_capacity_check" CHECK ("vehicles"."capacity" > 0)
);
--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_state_id_states_id_fk" FOREIGN KEY ("state_id") REFERENCES "public"."states"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_cargo_items" ADD CONSTRAINT "manifest_cargo_items_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_taxes" ADD CONSTRAINT "manifest_taxes_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifest_trailers" ADD CONSTRAINT "manifest_trailers_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_origin_city_id_cities_id_fk" FOREIGN KEY ("origin_city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_destination_city_id_cities_id_fk" FOREIGN KEY ("destination_city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "states" ADD CONSTRAINT "states_capital_city_id_cities_id_fk" FOREIGN KEY ("capital_city_id") REFERENCES "public"."cities"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_setting_changes" ADD CONSTRAINT "tax_setting_changes_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_documents" ADD CONSTRAINT "trip_documents_manifest_id_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."manifests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_company_name_idx" ON "branches" USING btree ("company_id","name");--> statement-breakpoint
CREATE INDEX "cities_state_id_idx" ON "cities" USING btree ("state_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_company_phone_idx" ON "drivers" USING btree ("company_id","phone");--> statement-breakpoint
CREATE INDEX "login_attempts_username_at_idx" ON "login_attempts" USING btree ("username","at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_at_idx" ON "login_attempts" USING btree ("ip","at");--> statement-breakpoint
CREATE INDEX "manifest_cargo_items_manifest_id_idx" ON "manifest_cargo_items" USING btree ("manifest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "manifest_taxes_manifest_code_idx" ON "manifest_taxes" USING btree ("manifest_id","code");--> statement-breakpoint
CREATE INDEX "manifest_trailers_manifest_id_idx" ON "manifest_trailers" USING btree ("manifest_id");--> statement-breakpoint
CREATE INDEX "manifests_vehicle_id_idx" ON "manifests" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "manifests_branch_id_idx" ON "manifests" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "manifests_status_idx" ON "manifests" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_company_key_idx" ON "roles" USING btree (coalesce("company_id", 0),"key") WHERE "roles"."key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_documents_manifest_type_idx" ON "trip_documents" USING btree ("manifest_id","doc_type");--> statement-breakpoint
CREATE INDEX "users_company_id_idx" ON "users" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "vehicles_company_id_idx" ON "vehicles" USING btree ("company_id");