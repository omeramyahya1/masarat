CREATE TABLE `esali_sim_bills` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bill_id` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payment_ref` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT "esali_sim_bills_status_check" CHECK("esali_sim_bills"."status" IN ('pending', 'paid', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `esali_sim_bills_bill_id_unique` ON `esali_sim_bills` (`bill_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `esali_sim_bills_payment_ref_unique` ON `esali_sim_bills` (`payment_ref`);