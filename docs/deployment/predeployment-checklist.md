# Pre-deployment checklist

What must be true before Masarat serves real companies and real money. The application's own readiness (logging, stateless API, validation, roles, the rolling window, caching, end-to-end tests) is done; these are the steps around it. Tick each one in the release ticket.

## 1. External systems

- [ ] **E-Sali**: the real API replaces the simulation (`services/esali.ts`, the `EsaliGateway` interface):
  - timeouts and retries, with one bill per manifest (already enforced)
  - clear errors while E-Sali is down
  - payment confirmation by its webhook if it has one, otherwise a reconciliation job that polls pending bills (`refreshBillStatus`, `addPaidTrip`)
  - Waiting for E-Sali's documentation.
- [ ] **Pricing**: the agency's real rules replace the development formula (`services/pricing.ts`). The API refuses to start in production until then.
- [ ] Drop `esali_sim_bills` and the demo-only routes' code paths once the real integration is live.

## 2. Configuration and secrets

- [ ] **`APP_ENV=production`.** The API then refuses to start:
  - with a setting left to its local default (`DATABASE_URL`, `MIGRATION_DATABASE_URL`, `SITE_URL`, `OWNER_URL`, `GOVT_URL`, `COOKIE_DOMAIN`, `REDIS_URL`, the `S3_*` keys)
  - with `DEMO_MODE=true`
  - with plain-http URLs
  - connected as the owner role
- [ ] **Secrets**: the database passwords, the S3 keys and the Redis password are kept in the platform's secret store, never in the repository or an image.
- [ ] **`TRUST_PROXY=true`** behind the proxy, so the per-IP limits see real client addresses. Also set `INSTANCE_NAME` per instance.

## 3. Database

- [ ] **Postgres 18** with `pg_trgm`.
- [ ] **The two roles.**
  - The owner role runs migrations (`MIGRATION_DATABASE_URL`).
  - `masarat_app` is created by migration 0010, or by the DBA beforehand. The DBA sets its password: `ALTER ROLE masarat_app LOGIN PASSWORD '…'`.
  - The API's `DATABASE_URL` uses `masarat_app`. At startup the API checks it isn't the owner or a superuser.
- [ ] **The archive's storage.** Put the archive schema's tables on the larger, slower disk:
  1. `CREATE TABLESPACE warm LOCATION '/mnt/warm/pg'` (as a superuser)
  2. For each table in `archive.*`: `ALTER TABLE archive.<table> SET TABLESPACE warm`
- [ ] **Slow queries.** `log_min_duration_statement = 500ms` and `pg_stat_statements` on, so slow queries show in the Postgres log and in Grafana.
- [ ] **The migration runbook**, on every deploy:
  1. Take a backup.
  2. `bun run db:migrate` as the owner. On a database with volume, migrations that build indexes go in a maintenance window (CLAUDE.md, _Indexes on big tables_).
  3. Deploy the API.
  4. Check `/health/ready`.

## 4. The single government admin

- [ ] **Create it once.** On the server: `bun run --filter @masarat/api user:create-admin <username> <phone> "<full name>"`. It prints a temporary password, which the admin replaces at their first login. In production the command refuses when an admin already exists.
- [ ] **Replacing the admin is a manual step.** As the owner role, take the role from the current admin (their history stays), then run `user:create-admin` again:
  ```sql
  BEGIN;
  -- The current admin becomes a disabled government agent
  UPDATE users SET role_id = (SELECT id FROM roles WHERE company_id IS NULL AND key = 'govt_agent'),
                   disabled_at = now()
  WHERE role_id = (SELECT id FROM roles WHERE company_id IS NULL AND key = 'govt_admin');
  DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users WHERE disabled_at IS NULL);
  COMMIT;
  ```

## 5. Hosting and the network

- [ ] **Reverse proxy or load balancer.**
  - TLS for `masarat.com`, `owner.`, `govt.` and `api.`, with HTTP redirected to HTTPS.
  - Health checks on `GET /health/ready`, so an instance that can't reach Postgres, Redis or MinIO, or is stopping, gets no traffic.
  - It sets `X-Request-Id`, or passes the client's.
- [ ] **API instances (at least 2).**
  - Stopped with SIGTERM: each lets its requests finish for up to `SHUTDOWN_GRACE_MS` (25 s). Allow at least that in the orchestrator.
  - The request body limit at the proxy is above 20 MB, for attachments.
- [ ] **The three web apps** served as static files. Every path serves `index.html` (client-side routing). Assets get long caching, `index.html` none.
- [ ] **The web apps' security headers**, set by the static host:
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - A Content Security Policy:
    - `default-src 'self'`
    - `connect-src 'self' https://api.masarat.com`
    - `img-src 'self' data: blob:`
    - `frame-src blob:` (the attachment preview)
    - `style-src 'self' 'unsafe-inline'`
    - `font-src 'self'`
    - `frame-ancestors 'none'`
- [ ] **MinIO.**
  - Erasure-coded disks, the `masarat-documents` bucket, and a key with access to that bucket only.
  - A lifecycle (tiering) rule moving objects older than 30 days to the cheaper tier.
  - Attachment upload throughput tested on the real server: 1–3 files of about 2 MB per cargo trip, at the peak hour's rate. See [sizing.md](sizing.md).
- [ ] **Redis**: a password, and not reachable from outside the private network.

## 6. Logs and monitoring

- [ ] **Logs.** The API writes JSON lines to stdout and to daily files kept for 7 days.
  - Ship stdout to the log platform (Loki or similar), keyed by `instance` and searchable by `requestId`.
  - A user reporting an error can quote the request id from the reply.
- [ ] **Metrics: Prometheus and Grafana.**
  - **API**: request rate, error rate and p95 per route; the Postgres pool in use; E-Sali calls and failures.
  - **Postgres**: connections, replication lag, the slowest statements (`pg_stat_statements`), disk.
  - **MinIO and Redis**: up, disk, memory.
  - **The jobs**: last success of `trips.archive` and `uploads.sweep`.
- [ ] **Alerts.**
  - an instance not ready
  - error rate above 1% for 5 minutes
  - p95 above the targets (`loadtest/README.md`)
  - replication lag
  - disk above 80%
  - a job that hasn't succeeded in 26 hours
  - an expired TLS certificate

## 7. Backups and recovery

- [ ] Follow [backup-plan.md](backup-plan.md): daily backups of Postgres and MinIO to another location, kept for the agreed time.
- [ ] **A restore drill, timed.** That time is the real RTO.

## 8. Build and release

- [ ] **CI on every change**: install with bun, then `typecheck`, `lint`, `test` (with Postgres, Redis and MinIO as service containers), `build`, and `e2e`.
- [ ] **A release pipeline.** It builds the API's container image (Bun, `TZ=Africa/Khartoum`) and the three static builds, and deploys them with the migration runbook above.
- [ ] **A rollback plan.** Keep the previous image. Migrations only add and fill before a later migration drops (CLAUDE.md), so the previous API still runs on the new schema.

## 9. Accounts and access (later, before wider rollout)

- [ ] MFA / one-time codes for government accounts (SMS, once the SMS integration exists).
- [ ] An audit trail for sensitive actions: exports with IDs, role changes, password resets, the government viewing trips.

## 10. Data retention

- [ ] **The archive period.** The agency's lawyers set how long archived trips (tax records, receipts, manifests) and their attachments must be kept. Nothing is deleted until that's decided.
- [ ] Backup retention set to match (see the backup plan).
