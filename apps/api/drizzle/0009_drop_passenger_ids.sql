ALTER TABLE "trip_passengers" DROP CONSTRAINT "trip_passengers_id_type_check";--> statement-breakpoint
ALTER TABLE "trip_passengers" DROP CONSTRAINT "trip_passengers_id_check";--> statement-breakpoint
DROP INDEX "trip_passengers_id_number_idx";--> statement-breakpoint
ALTER TABLE "trip_passengers" DROP COLUMN "id_type";--> statement-breakpoint
ALTER TABLE "trip_passengers" DROP COLUMN "id_number";