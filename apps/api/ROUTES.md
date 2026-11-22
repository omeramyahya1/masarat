# API routes

The Electron MVP talked to its main process over IPC (`apps/desktop-demo/src/main/index.ts`).
Each channel is now an HTTP endpoint here (`src/routes/`), calling the same service functions
(`src/services/`). New routes follow the same pattern.

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

The government portal's routes are done: `/govt/reference`, `/govt/owners`, `POST /govt/dashboard`
(filters and view as JSON), `GET /govt/search` (paged), `/govt/trips/:id`,
`/govt/documents/:id/file`, `GET|PUT /govt/tax-settings`, `POST /govt/exports` (one file or a ZIP)
and `POST /govt/demo/regenerate` (demo mode). The report prints from the browser, so
`govt:save-report-pdf` has no route.

Every IPC channel of the demo now has its route.

These are dropped on the web: `updater:*`, `app:get-version` (the portals get the version at build
time) and `ping`.

The Electron main process's startup work (`clearStaging`, `removeOrphanFolders`, `ensureDemoData` in
demo mode) runs at the API's startup, in `src/index.ts`.
