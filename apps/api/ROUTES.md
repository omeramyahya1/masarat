# API routes to build

The Electron MVP talked to its main process over IPC (`apps/desktop-demo/src/main/index.ts`).
Each channel below becomes an HTTP endpoint here. The service functions already exist in
`src/services/`. What's missing is the routes, sessions and the portals' `api` client.

**Sessions** are still the desktop model: `services/auth.ts` keeps one signed-in user per role
in memory. The web needs per-request sessions (cookie or token) passed into each service.

| Group        | IPC channel                                                                                                   | Service function                                  | Who              |
| ------------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------- |
| auth         | `auth:sign-up`, `auth:log-in`, `auth:log-out`, `auth:get-session`, `auth:update-profile`                      | `services/auth.ts`                                | both portals     |
| fleet        | `fleet:list-vehicles`, `fleet:add-vehicle`, `fleet:update-vehicle`, `fleet:delete-vehicle`                    | `services/fleet.ts`                               | owner            |
| fleet        | `fleet:list-drivers`, `fleet:add-driver`, `fleet:update-driver`, `fleet:delete-driver`                        | `services/drivers.ts`                             | owner            |
| trips        | `trips:get-reference-data`, `trips:list`, `trips:suggestions`, `trips:create`, `trips:update`, `trips:delete` | `services/trips.ts`                               | owner            |
| billing      | `billing:get-trip`, `billing:generate`, `billing:refresh`, `billing:simulate-payment`                         | `services/billing.ts`                             | owner            |
| documents    | `documents:pick` → **upload** (`stageDocument`)                                                               | `services/documents.ts`                           | owner            |
| documents    | `documents:open` → **download** (`findOwnedDocumentFile`)                                                     | `services/documents.ts`                           | owner            |
| documents    | `documents:scan`                                                                                              | `services/ocr.ts` (`scanDocument`)                | owner            |
| certificates | `certificates:save-pdf` → done in the browser (print to PDF)                                                  | none                                              | both portals     |
| govt         | `govt:get-reference-data`, `govt:list-owners`                                                                 | `services/trips.ts`, `services/analyticsQuery.ts` | govt             |
| govt         | `govt:dashboard`                                                                                              | `services/dashboard.ts`                           | govt             |
| govt         | `govt:search`, `govt:get-trip`                                                                                | `services/govtTrips.ts`, `services/billing.ts`    | govt             |
| govt         | `govt:open-document` → **download**                                                                           | `services/documents.ts`                           | govt             |
| govt         | `govt:export-data` → **download** (`exportData` returns the files)                                            | `services/exports.ts`                             | govt             |
| govt         | `govt:save-report-pdf` → done in the browser                                                                  | none                                              | govt             |
| govt         | `govt:get-tax-settings`, `govt:update-tax-rates`                                                              | `services/taxes.ts`                               | govt             |
| govt         | `govt:regenerate-demo`                                                                                        | `services/demoData.ts`                            | govt (demo only) |

These are dropped on the web: `updater:*`, `app:get-version` (the portals get the version at build
time) and `ping`.

Startup work in the Electron main process (`ensureDemoData`, `clearStaging`, `removeOrphanFolders`)
moves to the API's startup.
