# Masarat

## What this is

Masarat is an electronic transport, manifests, and tax-collection system tailored for Sudan. Its goal is to improve how transport taxes are paid and collected.

It started as an **Electron MVP / demo** for the relevant government agency (kept, frozen, in `apps/desktop-demo`). We are now building the **production web version**. External integrations (E-Sali, banks, OCR) are still **simulated** behind interfaces.

## App shape

Three web apps and one API, each on its own (sub)domain:

1. **Site** (`apps/site`, `masarat.com`): the public landing page, **login for everyone**, fleet owner sign-up, and the forced password change. A signed-in user is sent to their portal.
2. **Fleet Owner portal** (`apps/owner-portal`, `owner.masarat.com`): used by transport/fleet operators.
3. **Government portal** (`apps/govt-portal`, `govt.masarat.com`): used by government staff. It has the dashboard, search, tax settings, exports and (admins only) *Users*.
4. **API** (`apps/api`, `api.masarat.com`): one Hono app on Bun that all three call.

The Electron demo showed both panels in one window with a toggle. The web apps don't: the account's role decides the portal.

## Login and sessions

- **One login, on masarat.com** (`apps/site`): username and password only; the account's role picks the portal. After login the site goes to `?next=` when it's a page of the user's own portal (`destinationFor` in `packages/ui/src/lib/urls.ts`; anything else would be an open redirect), otherwise to the portal's home. A signed-in user who opens masarat.com is sent straight on.
- **The portals have no login page.** `AppShell` asks `GET /auth/me`; without a session it sends the browser to `masarat.com/login?next=<this page>`, a user of the other role to their own portal, and a user with a temporary password to `masarat.com/change-password`. Any API call that answers 401 fires `SIGNED_OUT_EVENT` (`@masarat/api-client`), which does the same. Logout returns to masarat.com.
- **Sessions** (`services/sessions.ts`, `sessions` table): a random 32-byte token in the `masarat_session` cookie (HttpOnly, SameSite=Lax, Secure over HTTPS, `Domain=COOKIE_DOMAIN` = `.masarat.com` in production so every subdomain sends it; unset locally, where one host-only cookie on `localhost` covers every port). Only the token's SHA-256 is stored. A session ends after **2 h idle** or **12 h** in all, and at once when the account is disabled or its password reset. Changing your own password signs out your other sessions. Expired rows are purged on startup and hourly.
- **Passwords**: Argon2id (`Bun.password`). Older scrypt hashes still verify and are rehashed at the next login.
- **Rate limit** (`login_attempts`): 5 failures per username or 20 per IP in 15 minutes give `too_many_attempts`. A wrong password and an unknown username answer the same (`invalid_credentials`, timed alike); `account_disabled` is only told after the password checks out.
- **CSRF and CORS** (`src/http/middleware.ts`, `src/app.ts`): requests that change something must carry an `Origin` that is one of `SITE_URL`, `OWNER_URL`, `GOVT_URL`; CORS allows exactly those, with credentials.
- **Sign-up is for fleet owners only.** Government accounts are created by a **government admin** (`users.is_admin`, government only) in Government portal → *Users* (`services/govtUsers.ts`, `components/govt/users/`): create (a 12-character temporary password shown once), disable / enable, reset password, make / remove admin. An admin can't change their own account there, and there is always one active admin (the admin rows are locked, so two admins demoting each other at once can't both succeed). Accounts with a temporary password (`must_change_password`) can only call `/auth/me`, `/auth/change-password` and `/auth/logout` until they pick their own.
- **The first admin** of a new deployment comes from the server: `bun run --filter @masarat/api user:create-admin <username> "<full name>"` prints its temporary password. The demo government account is an admin.
- **Demo mode** (`DEMO_MODE=true`, never in production): seeds the demo data, shows the demo accounts on the login page (`GET /config`), and allows the demo-only actions (simulated payment, regenerate demo data).

## Production status

Login works end to end; the portals' features are **not wired up yet**.

- **Both portals are wired** to the API (`apps/api/src/routes/`, listed in `apps/api/ROUTES.md`): the owner's `/vehicles`, `/drivers`, `/trips`, `/documents`, and the government's `/govt/*`. Each route takes the user from the session (`c.get('user')`) and passes their id to the service (`null` for the government's read-only views of any owner).
- `@masarat/api-client` follows the old `window.api`, except where the desktop did things natively: files are uploaded (`documents.upload`) and fetched as blobs (`documents.file`, `govt.documentFile`), exports come back as a file to save (`lib/saveFile.ts`), and documents and the report print from the browser. CORS exposes `Content-Disposition` and `X-Export-Rows`, so the client can read a download's name and an export's row counts.
- **Deployment notes so far**: trip attachments live on the API server's disk (`STORAGE_DIR`), so there is one API server, with that folder on a persistent, backed-up volume. The API runs on Sudan time (`TZ=Africa/Khartoum`, see Tech stack).
- The database is **Postgres**. File storage and deployment are still open questions for the production brainstorm.
- **The data model is being revised.** The rules below describe the behaviour carried over from the MVP.
- IPC channel names in the rules below (`documents:pick`, `govt:get-trip`, …) are the demo's, and each one becomes an API route. Anything the desktop did with native dialogs or `printToPDF` (picking files, opening files, saving PDFs, export save dialogs) still has to be redone for the browser. On the API side that's already started: uploads go through `stageDocument`, and `exportData` returns the files.

## Repo layout

Bun workspaces (`apps/api`, `apps/site`, `apps/*-portal`, `packages/*`):

- `packages/shared` (`@masarat/shared/<module>`): domain rules in plain TS (plates, trip cost and taxes, bill IDs, analytics filters, demo accounts), used by the API and both portals.
- `packages/ui` (`@masarat/ui/<path>`, a path alias in `tsconfig.base.json` and in each portal's `vite.config.ts`): the React code both portals use:
  - `AppShell` (header, session check and redirects, user bar)
  - `auth/` (form fields, `useAuthSubmit`), `ui/`, `form/`, `PlateBadge`
  - the read-only trip view and documents (`trips/TripDetails`, `CertificateModal`, `ReceiptPage`, `ManifestPage`, …)
  - `lib/` (`urls.ts`: the web apps' URLs and `destinationFor`), `i18n/` (both locale files, for all three web apps), and `assets/main.css`, which each portal imports from `main.tsx` and which adds `packages/ui` to Tailwind's sources
- `packages/api-client` (`@masarat/api-client`): the `api` object and its `MasaratApi` type, calling the API with `fetch` and the session cookie (`VITE_API_URL`).
- `apps/site/src`: `App.tsx` (session check and redirects), `router.ts` (four paths: `/`, `/login`, `/signup`, `/change-password`; the host must serve `index.html` for all of them), `pages/`, `components/auth/` (`LoginForm`, `SignUpForm`, `ChangePasswordForm`). Each web app reads `VITE_API_URL`, `VITE_SITE_URL`, `VITE_OWNER_URL` and `VITE_GOVT_URL` (`.env.example`; the defaults are the local URLs).
- `apps/owner-portal/src/components`: `fleet/`, `owner/`, `OwnerWorkspace`, and the trip form and list (`trips/TripForm`, `TripsPanel`, `CargoItemsEditor`, `DocumentsField`, …).
- `apps/govt-portal/src/components/govt`: the dashboard, search, tax settings, report, exports and `users/`.
- `apps/api/src`: `app.ts` (middleware and routes), `index.ts` (startup, then serves `app`), `routes/`, `http/` (context, cookie, middleware), `services/`, `db/` (`schema.ts`, `client.ts`, `migrate.ts`), `scripts/` (`createAdmin.ts`), `config.ts` (env from `apps/api/.env`, see `.env.example`: `DATABASE_URL`, `PORT`, `STORAGE_DIR`, `DEMO_MODE`, `SITE_URL`, `OWNER_URL`, `GOVT_URL`, `COOKIE_DOMAIN`, `TRUST_PROXY`). Migrations are in `apps/api/drizzle`, tests in `apps/api/test` (services, and the HTTP routes through `app.request()`).
- `apps/desktop-demo`: the Electron MVP as of 1.1.1. It's a **separate bun project** (its own `bun.lock`, not a workspace) with its own copy of `src/shared`, so changes here never break it. See its `CLAUDE.md`.

Short paths in the rules below: `services/*` is `apps/api/src/services/*`. Component and `lib/` paths are in `packages/ui/src` or in the portal that owns them.

## Core flow (Fleet Owner)

1. **Log in.**
2. **Create a new trip** with its details: vehicle type, cargo type, plate number, etc.
3. **Tax calculation**: the system computes the tax due for the trip.
4. **Bill generation**: the app simulates an **E-Sali (Esali) API** call that returns a **bill ID**.
5. **Payment**: the user pays that bill ID through **Bankak** or another bank. The MVP simulates this.
6. **Payment confirmation**: once the system confirms payment, it moves on to the next step.
7. **Documents**: the app issues the **electronic payment receipt** and the **authorized manifest** (تصريح الحركة), each with a barcode of its number and a **QR code** that traffic/checkpoint **officers can scan to verify it quickly**.

## Fleet & trips rules

- **Plate numbers** (`packages/shared/src/plate.ts`): a state code of 1-2 letters (KH, RS, NK, …), a series from 1 to 99, then a number from 1 to 99999. They are stored in English as `"KH 12/34567"` and shown in Arabic as `"خ ١٢ / ٣٤٥٦٧"` (letters → series → number, read right to left), with Eastern Arabic digits. Validation happens in the UI and services, not as a DB constraint.
- **Digits**: plates are the only thing shown with Eastern Arabic digits (badge, plate text, plate inputs). Every other number, amount and date uses English digits, even in the Arabic UI. Stored and backend values are always English.
- **Trip cost** (`calculateItemsCost` in `packages/shared/src/tax.ts`): the sum of the cargo items' costs. Each item costs `rate_per_km × distance_km × quantity / per_quantity` at its own cargo type's rate (`tax_rates`), with its quantity in the rate's unit. Items keep a snapshot of the rate and their cost. Distance is the haversine distance between the cities × a 1.3 road factor (an estimate until real routing exists).
- **Taxes and fees** (`calculateTaxes`): the taxes are percentages of the trip cost. These are VAT (default 17%), business profit tax (3%) and locality tax (2%), stored in `tax_settings.rate_bps` as basis points (1700 = 17%).
  - The fees (`FEE_CODES`) are fixed amounts in whole SDG, added to every bill and not taxed. For now that is only the **manifest fee** (رسوم المنفيست, default 1500 SDG), stored in `tax_settings.amount`.
  - Bill lines (`LINE_CODES`) are the taxes, then the fees. A fee line has `rate_bps = null` and is labelled with its name only (`format.taxLine`).
  - Each line is rounded to whole SDG, and the total is their sum.
  - The **bill is the total of the taxes and fees** (`manifests.tax_amount`). The trip cost is shown for reference.
  - A trip's lines are kept in `manifest_taxes`. Drafts are priced when saved, and *Generate bill ID* reprices them at the current rates; from then on they're frozen.
  - The API recomputes cost and taxes on save; the portal's preview is never trusted.
- **Taxes and fees screen** (Government portal → *Taxes and fees*, `services/taxes.ts`): any government account can change the percentages, from 0 to 100% with up to 2 decimals, and the fees, in whole SDG from 0 to 1,000,000. Each change is logged in `tax_setting_changes`, with who made it and the old and new value (basis points for a tax, SDG for a fee). Roles and approval come later.
- **Cargo items** (`manifest_cargo_items`): each trip lists what it carries, with a name, quantity and unit.
  - Units are measurable only: trucks use `kg` / `ton` and tankers use `liter` / `m3` (`itemUnitsFor`).
  - Items are converted to the vehicle's unit (`toVehicleUnit`), and their total is `manifests.cargo_quantity`, which drives the trip cost and must fit the vehicle's capacity.
- **Cargo types** are chosen **per item**, so a trip can mix them. The type picks the item's per-km rate, and its unit must match the vehicle's (fuel and liquids (non-fuel) → liters → tanker; containers and general cargo → tons).
  - `manifests.cargo_type` / `rate_per_km` hold the trip's **main type**, the one that costs the most.
  - `tripCargoTypes` lists all of a trip's types. The trips list shows "Mixed cargo" when there's more than one.
- **Owner profile** (*Profile* section, `updateProfile` in `services/auth.ts`): the fleet owner edits their name, phone, company name, address and TIN (الرقم الضريبي). The company, address and TIN are the **carrier details** printed on their manifests. Sign-up also asks for the address and TIN (optional there). Limits: address up to 200 characters, TIN up to 30.
- **Vehicles** need a **registration number** (رقم الترخيص, `vehicles.registration_no`, up to 30 characters) when added or edited. It is null only for vehicles added before it existed; the vehicles list flags those.
- **Drivers** (*Drivers* section, `services/drivers.ts`, `drivers` table): each owner keeps a list of drivers with a name and phone. Phones are stored without spaces or dashes (`normalizePhone`: optional `+` and 7–15 digits) and are unique per owner.
- **Manifest details** (what the authorized manifest prints): each trip has a **trip type** (`domestic` / `import` / `export`), up to 3 **trailer plates** (`manifest_trailers`, each different from the vehicle's plate), a **driver** from the owner's list, and a **sender** and **receiver** (name, address, phone). Each cargo item also has a **packing type** (free text; common types in `PACKING_SUGGESTIONS` and the owner's earlier ones are suggested), a **number of packages** and optional **notes**. Its quantity is shown as the **weight**.
  - Drafts can leave the driver, sender, receiver and packing details empty, but what is entered is validated.
  - *Generate bill ID* needs `missingForBilling` (`packages/shared/src/fleet.ts`) to be empty: the driver, a complete sender and receiver, the packing type and package count on every item, and the owner's address and TIN. Otherwise it returns `incomplete_manifest`, and the trip page lists what's missing.
  - The manifest keeps its own copy of the driver's name and phone (saved with the draft and refreshed when the bill is generated) and of the **carrier details** (the owner's company name, or full name if there is none, plus the address and TIN, copied when the bill is generated).
  - A driver on a draft can't be deleted (`driver_in_use`); deleting one used only by billed trips sets their `driver_id` to null.
  - `trips:suggestions` returns earlier senders, receivers and packing types for the form.
- **Supporting documents** (`services/documents.ts`, `trip_documents`, UI in the owner portal's `trips/DocumentsField.tsx`): a trip can have one file per document type. The commercial invoice and packing list always apply, the certificate of origin for imports, and the import/export authorization for imports and exports (`documentTypesFor`). Files are PDF, JPG or PNG, up to 20 MB, and are optional.
  - *Attach* opens the browser's file picker and uploads the file (`POST /documents`, multipart, its own 20 MB body limit; `documents:pick` in the demo). `stageDocument` checks the extension, size and first bytes (a renamed file of another kind is refused), and writes it to `<STORAGE_DIR>/documents/staging/` (`userData` in the demo), named by a random token kept in memory **with the uploader's id**: no other owner can attach or scan it. Saving the trip moves it to `documents/<manifest id>/` and adds the row. Staging is emptied on startup.
  - Drafts can add, replace or remove attachments; documents of a type the trip no longer needs (after its type changed) are dropped on save. Deleting a draft, or regenerating demo data, removes the folder.
  - *View* opens an attachment in an **in-page preview** (`trips/DocumentPreview.tsx`, both portals): PDFs in the browser's own viewer, images as they are, with *Download* and previous / next (and the arrow keys, following the reading direction) through the trip's documents. The file comes as a blob from `GET /documents/:id/file` (`findOwnedDocumentFile`, sent inline with `nosniff` and `no-store`), so the API never has to allow being framed. In the demo, `documents:open` opened the system viewer.
- **OCR is simulated** (`services/ocr.ts`): the `OcrService` interface is where a real OCR / document AI service plugs in. `MockOcrService` waits about 1.5 s and returns one of three Arabic sample shipments (import, export, domestic), with cargo for the vehicle's unit.
  - The commercial invoice gives the sender, receiver and goods; the packing list gives the goods with packing and package counts; the certificate of origin sets the trip to Import (and the sender); the authorization sets import/export and both parties.
  - The shipment is picked from the original file name and size, and the form sends it back with each later scan, so a trip's documents agree.
  - The form merges what was read (`scannedItems.ts`: empty rows are replaced, rows with the same description get the packing, others are added) and highlights it until the owner edits it.
- **List tools** (`ui/ListToolbar.tsx`): the owner's Trips, Vehicles and Drivers lists have a search box, filters, sort with a direction toggle and, except drivers, group-by with a header row per group (trips show count and total due). The settings are kept per list in `sessionStorage`.
  - **Vehicles and drivers** load in full and filter in the browser (`lib/useListView.ts`).
  - **Trips are paged by the API** (`lib/useServerList.ts`, `GET /trips`, `services/tripList.ts`): numbered pages (`ui/Pagination.tsx`, 25 / 50 / 100 per page), the search debounced. The API searches (`#id`, plate in either script, cities, driver, sender, receiver, item names), filters and sorts. **Grouping works across pages**: rows are ordered by their group first, each page shows the headers of its groups, and each header's count and total due cover the whole group (`groups` in the page). The portal labels the groups from their keys (status, `YYYY-MM`, vehicle id, driver id, `origin-destination` ids, trip kind, cargo type). The filters' vehicle and driver options come from the owner's lists.
- New trips are saved as `draft` manifests. Until their bill ID is generated, drafts can be edited in the same form (*Edit trip*, `updateTrip`) or **deleted** for good, with their items and tax lines (`deleteTrip`). Otherwise both return `not_draft`.

## Billing & certificates rules

- **Flow** (`apps/api/src/services/billing.ts`, UI in `components/trips/TripDetails.tsx`): `draft` → *Generate bill ID* → `billed` (shown as "Pending payment") → the user pays the bill ID from any banking app → *Refresh status* → once E-Sali reports it paid, the payment is recorded, the receipt and the authorized manifest are issued (one `certificates` row) and the manifest becomes `certified` (shown as "Authorized"). Our `payments` row only changes on refresh.
- **E-Sali bill ID** (`packages/shared/src/billing.ts`): `yyyy` `mm` `0dd` (day as 3 digits) + 13 random digits = 22 digits, e.g. `2026110170000123456789`. One bill per manifest; generating again returns the existing bill.
- **E-Sali is simulated** behind the `EsaliGateway` interface in `apps/api/src/services/esali.ts`. The mock keeps E-Sali's side in the `esali_sim_bills` table (simulation only; drop it with the real API). The hidden "⋯ → Pay <billId>" menu on a pending trip marks the bill paid at E-Sali.
- **Documents** (`certificates` table, `components/trips/CertificateModal.tsx`): issued together once the bill is paid, valid until the end of trip date + 30 days. Always rendered in Arabic (`i18n.getFixedT('ar')` + `createFormatters`), issued by ديوان الضرائب with the Sudan emblem (`assets/sudan-emblem.svg`, Wikimedia Commons). *Print or save as PDF* opens the browser's print dialog (`lib/printDocument.ts`; the page title is set to the receipt number meanwhile, so *Save as PDF* suggests it as the file name). The demo used `webContents.printToPDF`. The `@media print` rules in `main.css` (with `@page` A4, 10 mm) print only the dialog's sheets.
  - **Every page is a fixed A4 sheet** (`DocumentSheet` in `documentParts.tsx`, 190 × 276 mm inside the 10 mm page margin; `.print-sheet ~ .print-sheet` breaks the page). Each sheet repeats the letterhead (authority lines, emblem centred, and on the left the **Code 128 barcode** of the document number with the issue date) and a footer with the **QR at the bottom left** and "صفحة n من N". The barcode carries the MSR-/MNF- number itself, so there is no Arabic caption under it. `documentFrame.ts` builds what a document's sheets repeat.
  - **Page 1** (`ReceiptPage.tsx`) is the **electronic payment receipt** (إيصال سداد إلكتروني), number `MSR-<yyyy>-<manifestId 6 digits>` (`certificate_no`), with the trip cost and each tax and fee line. It fits one page.
  - Then the **authorized manifest** (`ManifestPage.tsx`) (تصريح حركة بضائع بري), number `MNF-<yyyy>-<manifestId 6 digits>` (`manifest_no`). It lists the vehicle, trailers, registration no., route and trip type; a table of the carrier, driver, sender and receiver; the cargo (description, packing, packages, weight, notes); the financial and customs section (قيمة الترحيل = the trip cost, رقم الإقرار الجمركي left blank); and name / signature / date / stamp blocks for the carrier, the driver (received the goods) and the receiver (on delivery). Customs, Zakat and others stamp the printed copy; that's out of scope. A typical trip fits one A4 page.
  - **Pagination** (`usePagedRows.ts`): the manifest renders a hidden copy of itself on one sheet with every cargo row, measures it (again once fonts load), and deals the rows out: page 1 opens with the vehicle, trip and parties table, later pages are titled "(تابع)" and repeat the cargo table header, and the total row, financial section and signatures stay together on the last page with at least one row above them.
  - The barcodes come from `bwip-js` (imported as `bwip-js/node`), rendered as SVG by the API (the main process in the demo).
- **QR payload** (`buildQrPayload`): JSON `{"esaliBillId","status":"paid","plate","manifestNo"}`, the same on both documents. Later it should become a URL to a page showing the manifest's status (looked up by `certificates.qr_token`).

## Government dashboard & demo data

- **Dashboard** (`apps/api/src/services/dashboard.ts`, UI in the govt portal's `components/govt/`): the Government portal opens on an overview across all fleet owners. In the demo, handlers go through `runGovt` (government session required); the API routes will need the same check.
  - **Filters** (`packages/shared/src/analytics.ts`, `AnalyticsFilters`): a period (presets 7 / 30 / 90 days, 12 months, this year, or custom dates, both days included) plus origin and destination (a city or a whole state), cargo type (any item of the trip), vehicle type, trip type and fleet owner. `services/analyticsQuery.ts` turns them into conditions (`inFilteredTrips`); the dashboard, the report, the data export reuse it. The filter bar is `AnalyticsFilterFields.tsx`, shared with the export dialog.
  - *Revenue collected*: paid payments (taxes and fees) by `paid_at` in the period, with the % change vs the previous period of the same length (hidden when the records don't reach back that far).
  - *Active trips*, *Pending bills* and *Registered vehicles* aren't limited to the period, but the other filters apply (vehicles follow only the vehicle type and owner filters).
  - *Collection rate*: paid ÷ billed amount for bills issued in the period.
  - Revenue chart: grouped by day / week (starting Sunday) / month, chosen by the user or picked from the range length (`resolveBucket`, at most 400 points). The last bucket is drawn dashed only when the period runs up to now.
  - *Revenue by cargo type* splits each trip's taxes across its items in proportion to their cost. *Revenue by tax and fee* sums the paid trips' `manifest_taxes` lines.
  - The **breakdown card** groups revenue by route, origin state, destination state, cargo type, vehicle type, trip type or fleet owner (`DashboardView.breakdown`, computed by the API) and sorts it by revenue, trips or name in the portal (`breakdownRows.ts`: top 9 plus "Others").
- **Search** (`services/govtTrips.ts`, `GovtSearchBar` / `GovtSearch`): one box above the government sections finds trips of every owner by E-Sali bill ID (or its first 6+ digits), `MNF-…` / `MSR-…` number (whole or partial), trip number (`#123`), plate in either script and with Western or Arabic digits (`plateSearchKey`; a digits-only query also matches plates), registration, company, driver, sender, receiver or city name, plus an optional origin / destination. Newest first, **paged by the API** (`GET /govt/search`, `ui/Pagination.tsx`; a new search starts on page 1).
- **Read-only trip view**: a search result or a dashboard bill opens `TripDetails` with `readOnly` (`govt:get-trip`: `getTripDetails(null, …)`, any owner). It shows the fleet owner, hides every owner action, and previews attachments (the same `DocumentPreview`, from `GET /govt/documents/:id/file`) and the receipt and manifest. The dashboard and the results stay mounted (hidden) behind it, so going back keeps their state.
- **Exports** (*Export* on the dashboard, `ExportDialog.tsx`), prefilled with the dashboard's filters. Exports are always in Arabic.
  - **Report (PDF)** (`ReportModal.tsx`): A4 sheets with the letterhead (`DocumentSheet` without barcode or QR). Page 1 has the parameters, key figures, revenue chart (fixed size, Arabic) and trip progress; page 2 has revenue by cargo and by tax and fee, and the breakdown. The user picks the chart grouping, breakdown and sort, and which sections to include. *Print or save as PDF* opens the browser's print dialog once the chart has drawn, suggesting `masarat-report-<dates>` as the file name (`govt:save-report-pdf` in the demo).
  - **Data (Excel / CSV)** (`services/exports.ts`, `packages/shared/src/exports.ts`): trips, bills & payments, cargo items and tax & fee lines. The period applies to the trip date, the bill's issue date or the payment date, with a trip status filter. Excel (exceljs) gives one right-to-left sheet per dataset with a frozen bold header; CSV is UTF-8 with a byte order mark, one file per dataset. Excel and CSV can be chosen together. `POST /govt/exports` sends one file as is, or several as one `masarat-export-<dates>.zip` (fflate), with the row counts in `X-Export-Rows`; the browser saves it (in the demo, several files went into a chosen folder). The options are checked (`isAnalyticsFilters`, `isExportOptions`) before anything runs. The export dialog has no owner filter: exports cover every fleet owner. Headers and value labels come from the portal's Arabic translations (`export.columns.*`); plates stay in their stored form, amounts are numbers.
- **Demo data** (`apps/api/src/services/demoData.ts`): only in demo mode (`DEMO_MODE=true`, never in production). On startup, if there are no demo owners, 4 demo fleet companies are seeded with about a year of trips, bills (with matching `esali_sim_bills` rows), payments and certificates, using the real trip cost and tax calculation (at the default percentages and fees). Each trip gets 1–4 cargo items with Arabic names, and about a quarter of tanker trips carry liquids. Some loads are mixed: about 15% of big-truck trips carry a container, and about 10% of fuel tanker trips carry liquids. It is deterministic (fixed PRNG seed, dates relative to today). Demo owners have an address and TIN (`packages/shared/src/demo.ts`), each vehicle a registration number, and each owner 5–8 drivers with Arabic names. Each trip also gets a trip type (imports and exports mostly on Port Sudan routes), sometimes trailers (big trucks), a driver, an Arabic sender and receiver, and packing details per item, and billed trips get the carrier details. All of these come from a second PRNG stream so the trips themselves stay the same. Demo users have `users.is_demo = true`. The Government portal's hidden *⋯ → Regenerate demo data* deletes the demo owners and everything under them (including anything added by hand to a demo company, and their sessions), then reseeds; other owners' data and the demo government account are kept.
- **Demo accounts** (`packages/shared/src/demo.ts`, `DEMO_ACCOUNTS`, listed under *Demo accounts* on the masarat.com login page in demo mode; clicking one fills the form):
  - Government (admin): `ministry.demo` / `govt2026`
  - Fleet owners: `nile.transport` / `nile2026`, `redsea.logistics` / `redsea2026`, `kordofan.haulage` / `kordofan2026`, `gezira.freight` / `gezira2026`
- **App version**: a grey badge in the header shows the portal's `package.json` version (`__APP_VERSION__`, set in `vite.config.ts`). In the demo it's `app.getVersion()` next to the MVP badge.
- Charts use **Recharts** (lazy-loaded) for the time series; ranked bars are plain HTML so they follow RTL. Charts keep time left → right in Arabic, with the value axis on the right.

## Tech stack

**BHVR**: Bun (runtime and package manager), Hono, Vite, React 19. TypeScript everywhere, Tailwind v4, Recharts, i18next.

- **Use bun only, never npm or npx**: `bun install`, `bun run <script>`, `bunx <bin>`, `bun add` inside the workspace.
- Bun blocks dependency install scripts unless the package is in `trustedDependencies`.
- The database is **Postgres + Drizzle ORM** through **postgres.js** (`apps/api/src/db`, config in `apps/api/drizzle.config.ts`, migrations in `apps/api/drizzle`). Locally it runs from `compose.yaml` (Postgres 18 on port **5433**, so it doesn't clash with another Postgres on 5432) with `bun run db:up`.
  - Every query is async. One row is `const [row] = await …limit(1)`. A check-then-write that must not race runs in `db.transaction(async (tx) => …)` and locks the row with `.for('update')` (see `lockedStatus` in `services/trips.ts`).
  - Text enums are `text` columns with a CHECK each (`inList`), not Postgres enums, so adding a value is a plain migration.
  - Migrations are a deploy step (`bun run db:migrate`), never run by the API at startup. `0000_init.sql` is generated; `0001_reference_data.sql` is a custom migration (`drizzle-kit generate --custom`) seeding the 39 cities, the cargo rates and the default taxes and fees.
  - Always read a generated migration before committing it. Renaming a column makes `drizzle-kit generate` ask an interactive question, which can't be answered here: write that migration by hand (`--custom` with `ALTER TABLE … RENAME COLUMN`) and update the schema to match.
  - Tests (`bun run test`) use their own `masarat_test` database, created and migrated by `apps/api/test/setup.ts`.
  - **Sudan time**: `config.ts` sets `TZ` (default `Africa/Khartoum`) and the Postgres session uses the same zone. Trip dates are local midnight and months group in local time, as on the desktop, whatever the host's zone.
  - When the shape of trip data changes, the migration deletes the **demo owners and everything under them** (their trips, bills, payments, certificates, `esali_sim_bills`, vehicles and drivers), so the next startup reseeds them in the new shape. **Other owners' data is always migrated, never deleted**: new columns start empty, bills already issued keep their lines and amounts, and copies in table rebuilds must keep every existing row.
- Prettier skips `**/drizzle`, so it never reformats the migration snapshots.
- The web apps reach data only through `@masarat/api-client`, never the database.

## Commands

All from the repo root:

- `bun install`
- `bun run db:up` / `db:down` (local Postgres), `bun run db:migrate`, `bun run db:generate` (new migration from `schema.ts`)
- `bun run dev`: the API and the three web apps together. Or one at a time: `bun run dev:api` (port 3000), `dev:site` (5175), `dev:owner` (5173), `dev:govt` (5174). Open http://localhost:5175 to log in.
- `bun run --filter @masarat/api user:create-admin <username> "<full name>"`: a government admin, for a new deployment
- `bun run dev:demo`: the Electron demo. Run `bun install` in `apps/desktop-demo` first, since it isn't a workspace.
- `bun run typecheck`, `bun run test` (API), `bun run build` (the three web apps), `bun run lint`, `bun run format`

## Releasing

Only the desktop demo has a release process for now: `bun run release`. See `apps/desktop-demo/CLAUDE.md`. The web deployment is still to be decided.

## Guidelines

- Mock or simulate external systems (E-Sali, Bankak/banks) behind clear interfaces so they can be swapped for real integrations later.
- Keep the flow smooth and visually credible for a government audience.
- This context will evolve. Update this file as requirements are clarified.
