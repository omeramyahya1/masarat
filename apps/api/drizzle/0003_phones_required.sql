-- Phones become required Sudanese mobile numbers in the international form ("+249912345678").
-- Numbers already written another way ("0912 345 678", "00249…", "249…", "912345678") are
-- rewritten; accounts with no valid number (or one another account already has) get a generated
-- "+249900" + their id, to be replaced from the profile.
CREATE FUNCTION pg_temp.sudan_phone(raw text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d ~ '^00249[19][0-9]{8}$' THEN '+' || substr(d, 3)
    WHEN d ~ '^249[19][0-9]{8}$' THEN '+' || d
    WHEN d ~ '^0[19][0-9]{8}$' THEN '+249' || substr(d, 2)
    WHEN d ~ '^[19][0-9]{8}$' THEN '+249' || d
  END
  FROM (SELECT regexp_replace(coalesce(raw, ''), '[^0-9]', '', 'g') AS d) AS cleaned
$$;--> statement-breakpoint
UPDATE "users" AS u SET "phone" = n."phone"
FROM (
  SELECT "id", CASE
    WHEN p IS NULL OR row_number() OVER (PARTITION BY p ORDER BY "id") > 1
      THEN '+249900' || lpad("id"::text, 6, '0')
    ELSE p
  END AS "phone"
  FROM (SELECT "id", pg_temp.sudan_phone("phone") AS p FROM "users") AS normalized
) AS n
WHERE u."id" = n."id";--> statement-breakpoint
UPDATE "drivers" AS d SET "phone" = n."phone"
FROM (
  SELECT "id", CASE
    WHEN p IS NULL OR row_number() OVER (PARTITION BY "owner_id", p ORDER BY "id") > 1
      THEN '+249900' || lpad("id"::text, 6, '0')
    ELSE p
  END AS "phone"
  FROM (SELECT "id", "owner_id", pg_temp.sudan_phone("phone") AS p FROM "drivers") AS normalized
) AS n
WHERE d."id" = n."id";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_phone_unique" UNIQUE("phone");