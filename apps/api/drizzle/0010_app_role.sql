-- The least-privileged role the API connects as: it reads and writes rows, and can't create, alter
-- or drop anything. Migrations and seeding run as the owner. Roles belong to the whole Postgres
-- server: in production the DBA may create masarat_app beforehand; it can log in once its
-- password is set (`ALTER ROLE masarat_app LOGIN PASSWORD '…'`, see docs/deployment). Locally,
-- `bun run db:migrate` gives it the development password.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'masarat_app') THEN
    CREATE ROLE masarat_app NOLOGIN;
  END IF;
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO masarat_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO masarat_app;--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO masarat_app;--> statement-breakpoint
-- Tables and sequences later migrations create (as this same owner) get the same rights
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO masarat_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO masarat_app;--> statement-breakpoint
-- Nobody else creates objects in the schema (Postgres 15+ already defaults to this)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;--> statement-breakpoint
-- One government admin. The deployment creates it once (user:create-admin); replacing it means
-- taking the role from the current one by hand first (docs/deployment). The index is on the
-- government admin role's id, which the reference data seeded. A database that already has
-- several keeps one admin (a real account before a demo one, then the oldest); the others stay,
-- as government agents.
DO $$
DECLARE admin_role integer;
DECLARE agent_role integer;
BEGIN
  SELECT id INTO admin_role FROM roles WHERE company_id IS NULL AND key = 'govt_admin';
  SELECT id INTO agent_role FROM roles WHERE company_id IS NULL AND key = 'govt_agent';
  UPDATE users SET role_id = agent_role
  WHERE role_id = admin_role
    AND id <> (SELECT id FROM users WHERE role_id = admin_role ORDER BY is_demo, id LIMIT 1);
  EXECUTE format(
    'CREATE UNIQUE INDEX users_one_govt_admin_idx ON users ((true)) WHERE role_id = %s',
    admin_role
  );
END
$$;
