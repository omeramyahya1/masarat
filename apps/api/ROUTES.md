# API routes

The Electron MVP talked to its main process over IPC (`apps/desktop-demo/src/main/index.ts`).
Each channel is now an HTTP endpoint here (`src/routes/`), calling the same service functions
(`src/services/`). New routes follow the same pattern.

**Sessions and permissions** (`src/http/middleware.ts`, `src/http/company.ts`): `session` puts the
signed-in account (an `AuthUser`, with its company, role, branch and permissions) on the request as
`c.get('user')`. `requireUser()`, `requireKind('company' | 'govt')` and `requirePermission(...)`
(any of the permissions in `packages/shared/src/permissions.ts`) guard a route. Company routes
pass `companyScope(c)` (`{ companyId, branchId | null }`) to their services; the government's
read-only views pass `null`. Results go out with `send(c, result)`.

Done: `GET /health`, `GET /config`, `POST /auth/login`, `POST /auth/signup` (a new company and its
admin), `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/profile` (own name and phone),
`POST /auth/change-password`.

The company's administration: `PUT /company` (`company.profile`), `/branches` (`GET` any member,
`POST`, `PUT /:id`: `branches.manage`), `/roles` (`GET`, `POST`, `PUT|DELETE /:id`:
`roles.manage`), and `/members` (`members.manage`: `GET`, `GET /roles`, `POST`,
`POST /:id/{disable,enable,reset-password}`, `PUT /:id/role`). `/govt/users` has the same routes for
the government (`govt.users`).

The company portal's routes are done too: `/vehicles`, `/drivers` (CRUD; reading needs
`fleet.view` / `drivers.view` or `trips.view`, changing `fleet.manage` / `drivers.manage`), `/trips` (`GET /` paged,
`/reference`, `/suggestions`, `POST`, `PUT|DELETE /:id`, `GET /:id`, `POST /:id/{bill,refresh,simulate-payment}`)
and `/documents` (`POST /` multipart upload, `GET /:id/file`; the demo's `documents:scan` was
dropped with OCR). Trips need `trips.view` to read (`/reference` is for every member), `trips.edit`
to save or delete drafts and upload, `trips.bill` for `bill`, `refresh` and `simulate-payment`.
Saving the certificate as PDF is the browser's print dialog, so `certificates:save-pdf` has no
route.

The government portal's routes are done: `/govt/reference`, `/govt/companies`,
`POST /govt/dashboard` (`govt.dashboard`; filters and view as JSON), `GET /govt/search` (paged,
`govt.search`), `/govt/trips/:id` and `/govt/documents/:id/file` (`govt.search` or
`govt.dashboard`), `GET|PUT /govt/tax-settings` (`govt.charges`), `POST /govt/exports`
(`govt.exports`; one file or a ZIP) and `POST /govt/demo/regenerate` (demo mode). The report prints from the browser, so
`govt:save-report-pdf` has no route.

Public: `GET /verify/:token`, what a manifest's QR code opens (rate-limited per IP).

Every IPC channel of the demo now has its route.

These are dropped on the web: `updater:*`, `app:get-version` (the portals get the version at build
time) and `ping`.

The Electron main process's startup work (`clearStaging`, `removeOrphanFolders`, `ensureDemoData` in
demo mode) runs at the API's startup, in `src/index.ts`.
