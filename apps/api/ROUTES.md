# API routes to build

The Electron MVP talked to its main process over IPC (`apps/desktop-demo/src/main/index.ts`).
Each channel below becomes an HTTP endpoint here. The service functions already exist in
`src/services/`. What's missing is the routes, sessions and the portals' `api` client.

**Sessions** are done (`src/http/middleware.ts`): `session` puts the signed-in user on the
request as `c.get('user')`, and `requireUser()`, `requireRole('owner' | 'govt')` and
`requireAdmin` guard a route. Each new route passes the user's id to its service (owner services
take `ownerId`; the government's read-only ones take `null`). Results go out with `send(c, result)`.

Done: `GET /health`, `GET /config`, `POST /auth/login`, `POST /auth/signup` (fleet owners),
`POST /auth/logout`, `GET /auth/me`, `PATCH /auth/profile` (owner), `POST /auth/change-password`,
and `/govt/users` (`GET`, `POST`, `POST /:id/{disable,enable,reset-password,admin}`; admins).

The owner portal's routes are done too: `/vehicles`, `/drivers` (CRUD), `/trips` (`GET /` paged,
`/reference`, `/suggestions`, `POST`, `PUT|DELETE /:id`, `GET /:id`, `POST /:id/{bill,refresh,simulate-payment}`)
and `/documents` (`POST /` multipart upload, `POST /scan`, `GET /:id/file`). Saving the
certificate as PDF is the browser's print dialog, so `certificates:save-pdf` has no route.

| Group | IPC channel                                                        | Service function                                  | Who              |
| ----- | ------------------------------------------------------------------ | ------------------------------------------------- | ---------------- |
| govt  | `govt:get-reference-data`, `govt:list-owners`                      | `services/trips.ts`, `services/analyticsQuery.ts` | govt             |
| govt  | `govt:dashboard`                                                   | `services/dashboard.ts`                           | govt             |
| govt  | `govt:search`, `govt:get-trip`                                     | `services/govtTrips.ts`, `services/billing.ts`    | govt             |
| govt  | `govt:open-document` → **download**                                | `services/documents.ts`                           | govt             |
| govt  | `govt:export-data` → **download** (`exportData` returns the files) | `services/exports.ts`                             | govt             |
| govt  | `govt:save-report-pdf` → done in the browser                       | none                                              | govt             |
| govt  | `govt:get-tax-settings`, `govt:update-tax-rates`                   | `services/taxes.ts`                               | govt             |
| govt  | `govt:regenerate-demo`                                             | `services/demoData.ts`                            | govt (demo only) |

These are dropped on the web: `updater:*`, `app:get-version` (the portals get the version at build
time) and `ping`.

The Electron main process's startup work (`clearStaging`, `removeOrphanFolders`, `ensureDemoData` in
demo mode) runs at the API's startup, in `src/index.ts`.
