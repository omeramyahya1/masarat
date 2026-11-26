# Masarat

Electronic transport manifests and tax collection for Sudan: transport companies book trips at
their branches, the system prices their taxes and fees, issues an E-Sali bill ID, and once it's paid issues the payment
receipt and the authorized manifest with a QR code checkpoint officers can scan.

The production version is being built for the web. The original Electron MVP is kept in
`apps/desktop-demo`.

## Layout

| Workspace             | What it is                                                             |
| --------------------- | ---------------------------------------------------------------------- |
| `apps/api`            | Hono API on Bun, `api.masarat.com`                                     |
| `apps/site`           | Landing page, login and company sign-up, `masarat.com` (Vite + React)  |
| `apps/owner-portal`   | Transport company portal, `owner.masarat.com` (Vite + React)           |
| `apps/govt-portal`    | Government portal, `govt.masarat.com` (Vite + React)                   |
| `packages/shared`     | Domain rules: plates, trip cost and taxes, bill IDs, analytics filters |
| `packages/ui`         | React components, i18n (English / Arabic) and styles the web apps use  |
| `packages/api-client` | Typed client the web apps use to call the API                          |
| `e2e`                 | End-to-end tests (Playwright), run against a stack of their own        |
| `apps/desktop-demo`   | The Electron MVP (separate bun project, frozen)                        |

Docs: `docs/deployment/` (architecture, pre-deployment checklist, backup plan, sizing),
`docs/testing/e2e-scenarios.md`, `loadtest/README.md`.

## Setup

Needs [Bun](https://bun.com) 1.4+ and Podman (or Docker) for the local services. Bun is the only
package manager: don't use npm.

```bash
bun install
cp apps/api/.env.example apps/api/.env   # DATABASE_URL, REDIS_URL, S3_*, DEMO_MODE, …
bun run db:up                            # Postgres 18 (5433), Redis (6380), MinIO (9000) — compose.yaml
bun run db:migrate                       # applies apps/api/drizzle as the owner, and lets the API's role log in
```

## Development

```bash
bun run dev         # everything below at once
bun run dev:api     # http://localhost:3000
bun run dev:site    # http://localhost:5175  ← start here: log in
bun run dev:owner   # http://localhost:5173
bun run dev:govt    # http://localhost:5174
```

With `DEMO_MODE=true` the API seeds the demo companies (with their branches, admins, clerks and
accountants) on its first start, and the login page lists their accounts. The migrations were
rebased on 2026-11-22: drop an older local database and run `bun run db:migrate` again. A deployment
gets its one government admin from the server, once:
`bun run --filter @masarat/api user:create-admin <username> <phone> "<full name>"` (in development
it updates the existing admin instead).

```bash
bun run typecheck
bun run lint
bun run test        # API tests, against a masarat_test database
bun run e2e         # end-to-end scenarios in Chromium, on a stack of their own
bun run build       # the three web apps
```

Both portals are wired to the API. In development the API describes itself at
http://localhost:3000/openapi.json (OpenAPI, built from the routes' schemas).

## Desktop demo

```bash
cd apps/desktop-demo && bun install   # once
bun run dev:demo                      # from the root
```

See `apps/desktop-demo/README.md`.
