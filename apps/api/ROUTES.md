# API routes

The Electron MVP talked to its main process over IPC (`apps/desktop-demo/src/main/index.ts`).
Each channel is now an HTTP endpoint here (`src/routes/`), calling the same service functions
(`src/services/`). New routes follow the same pattern.

**The full list of endpoints**, with their request schemas, is the OpenAPI document the API serves in
development: `GET /openapi.json` (built from each route's `doc(...)` and zod schema, see
`src/http/validate.ts`). Every body and query is validated against its schema in
`packages/shared/src/schemas.ts` before a service runs.

**Sessions and permissions** (`src/http/middleware.ts`, `src/http/company.ts`): `session` puts the
signed-in account (an `AuthUser`, with its company, role, branch and permissions) on the request as
`c.get('user')`. `requireUser()`, `requireKind('company' | 'govt')` and `requirePermission(...)`
(any of the permissions in `packages/shared/src/permissions.ts`) guard a route. Company routes
pass `companyScope(c)` (`{ companyId, branchId | null }`) to their services; the government's
read-only views pass `null`. Results go out with `send(c, result)`.

Done: `GET /health`, `GET /config`, `POST /auth/login`, `POST /auth/signup` (a new company and its
admin), `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/profile` (own name and phone),
`POST /auth/change-password`.

Passenger trip templates: `/templates` (`GET`: `templates.use`; `POST`, `PUT|DELETE /:id`: `templates.manage`).

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
`govt.search`), `/govt/trips/:id` and `/govt/documents/:id/file` (`govt.search`,
`govt.dashboard` or `govt.reports.review`), `POST /govt/trips/:id/cancel` (a trip whose bill is
unpaid, `govt.reports.review`), the reports (`routes/reports.ts`, `services/reviews.ts`):
`POST /govt/reports` (report a certified trip, `govt.reports.create`), `GET /govt/reports` (paged,
by status) and `POST /govt/reports/:id/{dismiss,revoke}` (`govt.reports.review`; each change answers
the trip's page), `GET|POST /govt/charges` and `PUT /govt/charges/:id` (taxes and fees, `govt.charges`), `GET|PUT /govt/settings` (validity margin and average speeds, `govt.settings`), the data exports
(`govt.exports`, `services/exportQueue.ts`; prepared by the export worker, one at a time per account): `POST /govt/exports`
(queue one: 202 with the job; `export_in_progress` while another is under way), `GET /govt/exports/current` (the latest,
for the dialog), `GET /govt/exports/:id` (queued with how many are ahead, being prepared, done, failed or cancelled),
`GET /govt/exports/:id/file` (the file, one file or a ZIP, with `X-Export-Rows`; kept an hour) and
`DELETE /govt/exports/:id` (cancel), and `POST /govt/demo/regenerate` (demo mode). The report prints from the browser, so
`govt:save-report-pdf` has no route.

Public: `GET /verify/:token`, what a manifest's QR code opens (rate-limited per IP).

Every IPC channel of the demo now has its route.

These are dropped on the web: `updater:*`, `app:get-version` (the portals get the version at build
time) and `ping`.

The Electron main process's startup work (`clearStaging`, `removeOrphanFolders`, `ensureDemoData` in
demo mode) runs at the API's startup, in `src/index.ts`.
