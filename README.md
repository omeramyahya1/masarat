# Masarat

Electronic transport manifests and tax collection for Sudan: fleet owners create trips, the system
prices their taxes and fees, issues an E-Sali bill ID, and once it's paid issues the payment
receipt and the authorized manifest with a QR code checkpoint officers can scan.

The production version is being built for the web. The original Electron MVP is kept in
`apps/desktop-demo`.

## Layout

| Workspace             | What it is                                                                |
| --------------------- | ------------------------------------------------------------------------- |
| `apps/api`            | Hono API on Bun, `api.masarat.com`                                        |
| `apps/site`           | Landing page, login and fleet owner sign-up, `masarat.com` (Vite + React) |
| `apps/owner-portal`   | Fleet owner portal, `owner.masarat.com` (Vite + React)                    |
| `apps/govt-portal`    | Government portal, `govt.masarat.com` (Vite + React)                      |
| `packages/shared`     | Domain rules: plates, trip cost and taxes, bill IDs, analytics filters    |
| `packages/ui`         | React components, i18n (English / Arabic) and styles the web apps use     |
| `packages/api-client` | Typed client the web apps use to call the API                             |
| `apps/desktop-demo`   | The Electron MVP (separate bun project, frozen)                           |

## Setup

Needs [Bun](https://bun.com) 1.4+ and Podman (or Docker) for the local Postgres. Bun is the only
package manager: don't use npm.

```bash
bun install
cp apps/api/.env.example apps/api/.env   # DATABASE_URL, DEMO_MODE, …
bun run db:up                            # Postgres 18 on localhost:5433 (compose.yaml)
bun run db:migrate                       # applies apps/api/drizzle
```

## Development

```bash
bun run dev         # everything below at once
bun run dev:api     # http://localhost:3000
bun run dev:site    # http://localhost:5175  ← start here: log in
bun run dev:owner   # http://localhost:5173
bun run dev:govt    # http://localhost:5174
```

With `DEMO_MODE=true` the API seeds the demo fleet companies on its first start, and the login
page lists their accounts. A new deployment gets its first government admin from the server:
`bun run --filter @masarat/api user:create-admin <username> "<full name>"`.

```bash
bun run typecheck
bun run lint
bun run test        # API service tests, against a masarat_test database
bun run build       # the three web apps
```

Login, sessions and the government Users section work end to end. The portals' other features
aren't wired to the API yet: their calls fail with "not wired yet". `apps/api/ROUTES.md` lists
the endpoints to build.

## Desktop demo

```bash
cd apps/desktop-demo && bun install   # once
bun run dev:demo                      # from the root
```

See `apps/desktop-demo/README.md`.
