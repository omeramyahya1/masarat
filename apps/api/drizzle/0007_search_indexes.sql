-- Trips from or to a city, newest first (the government search). On a big database these can be
-- built beforehand with CREATE INDEX CONCURRENTLY under the same names and definitions: a valid
-- index with exactly this definition is kept, anything else under the name is replaced.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'manifests_origin_departure_idx' AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) =
        'CREATE INDEX manifests_origin_departure_idx ON public.manifests USING btree (origin_city_id, departure_at)'
  ) THEN
    DROP INDEX IF EXISTS "manifests_origin_departure_idx";
    CREATE INDEX "manifests_origin_departure_idx" ON "manifests" USING btree ("origin_city_id","departure_at");
  END IF;
END $$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'manifests_destination_departure_idx' AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) =
        'CREATE INDEX manifests_destination_departure_idx ON public.manifests USING btree (destination_city_id, departure_at)'
  ) THEN
    DROP INDEX IF EXISTS "manifests_destination_departure_idx";
    CREATE INDEX "manifests_destination_departure_idx" ON "manifests" USING btree ("destination_city_id","departure_at");
  END IF;
END $$;
