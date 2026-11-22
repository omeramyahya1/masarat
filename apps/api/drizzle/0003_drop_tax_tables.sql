-- The old tax tables, now copied into charges, charge_changes, manifest_charges and pricing_rates (0002)
DROP TABLE "manifest_taxes" CASCADE;--> statement-breakpoint
DROP TABLE "tax_rates" CASCADE;--> statement-breakpoint
DROP TABLE "tax_setting_changes" CASCADE;--> statement-breakpoint
DROP TABLE "tax_settings" CASCADE;