CREATE TABLE `vehicles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plate_number` text NOT NULL,
	`vehicle_type` text DEFAULT 'truck' NOT NULL,
	`capacity` real DEFAULT 0,
	`status` text DEFAULT 'active'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `vehicles_plate_number_unique` ON `vehicles` (`plate_number`);