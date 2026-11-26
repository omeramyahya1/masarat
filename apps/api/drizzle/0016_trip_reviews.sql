CREATE TABLE "trip_decisions" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_decisions_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"manifest_id" integer NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"note" text NOT NULL,
	"report_id" integer,
	"decided_by" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_decisions_manifest_id_unique" UNIQUE("manifest_id"),
	CONSTRAINT "trip_decisions_action_check" CHECK ("trip_decisions"."action" IN ('revoke', 'cancel')),
	CONSTRAINT "trip_decisions_reason_check" CHECK ("trip_decisions"."reason" IN ('forged_document', 'cargo_mismatch', 'wrong_vehicle', 'passenger_mismatch', 'other'))
);
--> statement-breakpoint
CREATE TABLE "trip_reports" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "trip_reports_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"manifest_id" integer NOT NULL,
	"reason" text NOT NULL,
	"note" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reported_by" integer NOT NULL,
	"resolved_by" integer,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_reports_reason_check" CHECK ("trip_reports"."reason" IN ('forged_document', 'cargo_mismatch', 'wrong_vehicle', 'passenger_mismatch', 'other')),
	CONSTRAINT "trip_reports_status_check" CHECK ("trip_reports"."status" IN ('open', 'revoked', 'dismissed')),
	CONSTRAINT "trip_reports_resolved_check" CHECK (("trip_reports"."status" = 'open') = ("trip_reports"."resolved_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "archive"."manifests" DROP CONSTRAINT "manifests_status_check";--> statement-breakpoint
ALTER TABLE "archive"."payments" DROP CONSTRAINT "payments_status_check";--> statement-breakpoint
ALTER TABLE "esali_sim_bills" DROP CONSTRAINT "esali_sim_bills_status_check";--> statement-breakpoint
ALTER TABLE "manifests" DROP CONSTRAINT "manifests_status_check";--> statement-breakpoint
ALTER TABLE "payments" DROP CONSTRAINT "payments_status_check";--> statement-breakpoint
ALTER TABLE "trip_decisions" ADD CONSTRAINT "trip_decisions_report_id_trip_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."trip_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_decisions" ADD CONSTRAINT "trip_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_reports" ADD CONSTRAINT "trip_reports_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_reports" ADD CONSTRAINT "trip_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trip_reports_manifest_id_idx" ON "trip_reports" USING btree ("manifest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trip_reports_one_open_idx" ON "trip_reports" USING btree ("manifest_id") WHERE "trip_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "trip_reports_status_created_idx" ON "trip_reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "trip_reports_created_idx" ON "trip_reports" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "archive"."manifests" ADD CONSTRAINT "manifests_status_check" CHECK ("archive"."manifests"."status" IN ('draft', 'billed', 'paid', 'certified', 'revoked', 'cancelled'));--> statement-breakpoint
ALTER TABLE "archive"."payments" ADD CONSTRAINT "payments_status_check" CHECK ("archive"."payments"."status" IN ('pending', 'paid', 'expired', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "esali_sim_bills" ADD CONSTRAINT "esali_sim_bills_status_check" CHECK ("esali_sim_bills"."status" IN ('pending', 'paid', 'expired', 'failed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "manifests" ADD CONSTRAINT "manifests_status_check" CHECK ("manifests"."status" IN ('draft', 'billed', 'paid', 'certified', 'revoked', 'cancelled'));--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_status_check" CHECK ("payments"."status" IN ('pending', 'paid', 'expired', 'failed', 'cancelled'));