# Masarat

Electronic transport manifests and tax collection for Sudan: fleet owners create trips, the system
prices their taxes and fees, issues an E-Sali bill ID, and once it's paid issues the payment
receipt and the authorized manifest with a QR code checkpoint officers can scan.

The production version is being built for the web. The original Electron MVP is kept in
`apps/desktop-demo`.

## Layout

| Workspace | What it is |
|---|---|
| `apps/api` | Hono API on Bun, shared by both portals |
| `apps/owner-portal` | Fleet owner portal, `owner.masarat.com` (Vite + React) |
| `apps/govt-portal` | Government portal, `govt.masarat.com` (Vite + React) |
| `packages/shared` | Domain rules: plates, trip cost and taxes, bill IDs, analytics filters |
| `packages/ui` | React components, i18n (English / Arabic) and styles both portals use |
| `packages/api-client` | Typed client the portals use to call the API |
| `apps/desktop-demo` | The Electron MVP (separate bun project, frozen) |

## Setup

Needs [Bun](https://bun.com) 1.4+. Bun is the only package manager: don't use npm.

```bash
bun install
```

## Development

```bash
bun run dev:api     # http://localhost:3000
bun run dev:owner   # http://localhost:5173
bun run dev:govt    # http://localhost:5174
```

```bash
bun run typecheck
bun run lint
bun run build       # both portals
```

The portals aren't wired to the API yet: they show their login page, and API calls fail with
"not wired yet". `apps/api/ROUTES.md` lists the endpoints to build.

## Desktop demo

```bash
cd apps/desktop-demo && bun install   # once
bun run dev:demo                      # from the root
```

See `apps/desktop-demo/README.md`.
