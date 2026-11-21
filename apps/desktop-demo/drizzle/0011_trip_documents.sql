CREATE TABLE `trip_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manifest_id` integer NOT NULL,
	`doc_type` text NOT NULL,
	`file_name` text NOT NULL,
	`stored_name` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`manifest_id`) REFERENCES `manifests`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "trip_documents_type_check" CHECK("trip_documents"."doc_type" IN ('commercial_invoice', 'packing_list', 'certificate_of_origin', 'trade_authorization'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trip_documents_manifest_type_idx` ON `trip_documents` (`manifest_id`,`doc_type`);