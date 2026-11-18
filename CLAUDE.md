# Masarat MVP

## What this is

Masarat is an electronic transport, manifests, and tax-collection system tailored for Sudan. Its goal is to improve how transport taxes are paid and collected.

This repo is an **MVP / demo** that will be shown to the relevant government agency. If they approve it, the full project gets built. So we optimize for a convincing, working demonstration of the end-to-end flow, not for production completeness. External integrations are **simulated**.

## App shape

It's an Electron desktop app with **two views the user can toggle between**:

1. **Fleet Owner view**: used by transport/fleet operators.
2. **Government Portal view**: used by the government representative. In the future it should show analytics and more. For the MVP it's the government-facing side of the same data.

## Core flow (Fleet Owner)

1. **Log in.**
2. **Create a new trip** with its details: vehicle type, cargo type, plate number, etc.
3. **Tax calculation**: the system computes the tax due for the trip.
4. **Bill generation**: the app simulates an **E-Sali (Esali) API** call that returns a **bill ID**.
5. **Payment**: the user pays that bill ID through **Bankak** or another bank. The MVP simulates this.
6. **Payment confirmation**: once the system confirms payment, it moves on to the next step.
7. **Certificate issuance**: the app issues a trip/tax **certificate with a QR code** that traffic/checkpoint **officers can scan to verify it quickly**.

## Fleet & trips rules

- **Plate numbers** (`src/shared/plate.ts`): a state code of 1-2 letters (KH, RS, NK, …), a series from 1 to 99, then a number from 1 to 99999. They are stored in English as `"KH 12/34567"` and shown in Arabic as `"خ ١٢ / ٣٤٥٦٧"` (letters → series → number, read right to left), with Eastern Arabic digits. Validation happens in the UI and services, not as a DB constraint.
- **Digits**: plates are the only thing shown with Eastern Arabic digits (badge, plate text, plate inputs). Every other number, amount and date uses English digits, even in the Arabic UI. Stored and backend values are always English.
- **Trip cost** (`calculateItemsCost` in `src/shared/tax.ts`): the sum of the cargo items' costs. Each item costs `rate_per_km × distance_km × quantity / per_quantity` at its own cargo type's rate (`tax_rates`), with its quantity in the rate's unit. Items keep a snapshot of the rate and their cost. Distance is the haversine distance between the cities × a 1.3 road factor (an estimate until real routing exists).
- **Taxes and fees** (`calculateTaxes`): the taxes are percentages of the trip cost. These are VAT (default 17%), business profit tax (3%) and locality tax (2%), stored in `tax_settings.rate_bps` as basis points (1700 = 17%).
  - The fees (`FEE_CODES`) are fixed amounts in whole SDG, added to every bill and not taxed. For now that is only the **manifest fee** (رسوم المنفيست, default 1500 SDG), stored in `tax_settings.amount`.
  - Bill lines (`LINE_CODES`) are the taxes, then the fees. A fee line has `rate_bps = null` and is labelled with its name only (`format.taxLine`).
  - Each line is rounded to whole SDG, and the total is their sum.
  - The **bill is the total of the taxes and fees** (`manifests.tax_amount`). The trip cost is shown for reference.
  - A trip's lines are kept in `manifest_taxes`. Drafts are priced when saved, and *Generate bill ID* reprices them at the current rates; from then on they're frozen.
  - The main process recomputes cost and taxes on save; the renderer's preview is never trusted.
- **Taxes and fees screen** (Government panel → *Taxes and fees*, `services/taxes.ts`): any government account can change the percentages, from 0 to 100% with up to 2 decimals, and the fees, in whole SDG from 0 to 1,000,000. Each change is logged in `tax_setting_changes`, with who made it and the old and new value (basis points for a tax, SDG for a fee). Roles and approval come later.
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
  - *Generate bill ID* needs `missingForBilling` (`src/shared/fleet.ts`) to be empty: the driver, a complete sender and receiver, the packing type and package count on every item, and the owner's address and TIN. Otherwise it returns `incomplete_manifest`, and the trip page lists what's missing.
  - The manifest keeps its own copy of the driver's name and phone (saved with the draft and refreshed when the bill is generated) and of the **carrier details** (the owner's company name, or full name if there is none, plus the address and TIN, copied when the bill is generated).
  - A driver on a draft can't be deleted (`driver_in_use`); deleting one used only by billed trips sets their `driver_id` to null.
  - `trips:suggestions` returns earlier senders, receivers and packing types for the form.
- New trips are saved as `draft` manifests. Until their bill ID is generated, drafts can be edited in the same form (*Edit trip*, `updateTrip`) or **deleted** for good, with their items and tax lines (`deleteTrip`). Otherwise both return `not_draft`.

## Billing & certificates rules

- **Flow** (`src/main/services/billing.ts`, UI in `components/trips/TripDetails.tsx`): `draft` → *Generate bill ID* → `billed` (shown as "Pending payment") → the user pays the bill ID from any banking app → *Refresh status* → once E-Sali reports it paid, the payment is recorded, the certificate is issued and the manifest becomes `certified`. Our `payments` row only changes on refresh.
- **E-Sali bill ID** (`src/shared/billing.ts`): `yyyy` `mm` `0dd` (day as 3 digits) + 13 random digits = 22 digits, e.g. `2026110170000123456789`. One bill per manifest; generating again returns the existing bill.
- **E-Sali is simulated** behind the `EsaliGateway` interface in `src/main/services/esali.ts`. The mock keeps E-Sali's side in the `esali_sim_bills` table (simulation only; drop it with the real API). The hidden "⋯ → Pay <billId>" menu on a pending trip marks the bill paid at E-Sali.
- **Certificate** (shown to users as the **electronic payment receipt**, إيصال سداد إلكتروني, issued by ديوان الضرائب): number `MSR-<yyyy>-<manifestId 6 digits>`, valid until the end of trip date + 30 days. Always rendered in Arabic (`i18n.getFixedT('ar')` + `createFormatters`), with the Sudan emblem (`assets/sudan-emblem.svg`, Wikimedia Commons). *Download PDF* uses `webContents.printToPDF`; the `@media print` rules in `main.css` print only `.print-certificate`.
  - **Page 1** is the receipt, with the trip cost and each tax and fee line.
  - **Page 2** and on (`.print-page-break`) is the cargo manifest table. Its header row repeats on each printed page, and the total is a normal last row, because a `<tfoot>` would repeat on every page.
  - Trips from before cargo items existed show their cargo type as a single row.
- **QR payload** (`buildQrPayload`): JSON `{"esaliBillId","status":"paid","plate"}`. Later it should become a URL to a page showing the manifest's status (looked up by `certificates.qr_token`).

## Government dashboard & demo data

- **Dashboard** (`src/main/services/dashboard.ts`, UI in `components/govt/`): the Government panel opens on an overview across all fleet owners, for the last 30 days, 90 days or 12 months. Handlers go through `runGovt` (government session required).
  - *Revenue collected*: paid payments (the taxes) by `paid_at` in the period, with the % change vs the previous period of the same length (hidden when the records don't reach back that far).
  - *Active trips*: certified trips whose certificate is still valid (`valid_until ≥ now`). *Pending bills*: all unpaid bills. Neither is period-filtered.
  - *Collection rate*: paid ÷ billed amount for bills issued in the period.
  - Revenue chart buckets: day / week (starting Sunday) / month. The current bucket is drawn dashed because it is incomplete. Breakdowns (cargo, tax, routes, origin state) count revenue by when it was paid.
  - *Revenue by cargo type* splits each trip's taxes across its items in proportion to their cost.
  - *Revenue by tax and fee* sums the paid trips' `manifest_taxes` lines, so the manifest fee is its own bar.
- **Demo data** (`src/main/services/demoData.ts`): on startup, if there are no demo owners, 4 demo fleet companies are seeded with about a year of trips, bills (with matching `esali_sim_bills` rows), payments and certificates, using the real trip cost and tax calculation (at the default percentages and fees). Each trip gets 1–4 cargo items with Arabic names, and about a quarter of tanker trips carry liquids. Some loads are mixed: about 15% of big-truck trips carry a container, and about 10% of fuel tanker trips carry liquids. It is deterministic (fixed PRNG seed, dates relative to today). Demo owners have an address and TIN (`src/shared/demo.ts`), each vehicle a registration number, and each owner 5–8 drivers with Arabic names. Each trip also gets a trip type (imports and exports mostly on Port Sudan routes), sometimes trailers (big trucks), a driver, an Arabic sender and receiver, and packing details per item, and billed trips get the carrier details. All of these come from a second PRNG stream so the trips themselves stay the same. Demo users have `users.is_demo = 1`. The Government panel's hidden *⋯ → Regenerate demo data* deletes the demo owners and everything under them (including anything added by hand to a demo company), then reseeds; other owners' data and the demo government account are kept, and a signed-in demo owner is signed out.
- **Demo accounts** (`src/shared/demo.ts`, listed under *Demo accounts* on both login pages; clicking one fills the form):
  - Government: `ministry.demo` / `govt2026`
  - Fleet owners: `nile.transport` / `nile2026`, `redsea.logistics` / `redsea2026`, `kordofan.haulage` / `kordofan2026`, `gezira.freight` / `gezira2026`
- Charts use **Recharts** (lazy-loaded) for the time series; ranked bars are plain HTML so they follow RTL. Charts keep time left → right in Arabic, with the value axis on the right.

## Tech stack

- Electron + electron-vite, React 19, TypeScript, Recharts
- `src/main`: Electron main process (`src/main/index.ts`)
- `src/main/db`: local database layer using **SQLite (better-sqlite3) + Drizzle ORM** (`schema.ts`, `client.ts`). The Drizzle config is in `drizzle.config.ts` and migrations go to `./drizzle`.
  - Migrations run with foreign keys off, then `foreign_key_check` runs, because drizzle rebuilds a table to change a CHECK.
  - Always read a generated migration: when a rebuild copies a column that doesn't exist yet, the SELECT has to be fixed by hand.
  - Renaming a column makes `drizzle-kit generate` ask an interactive question, which can't be answered here. Generate in two steps instead (first without the old columns, then with the new ones). Then merge them into one migration that uses `RENAME COLUMN`, keep the last snapshot, and fix its `prevId` and the journal.
  - When the shape of trip data changes, the migration deletes all trips (manifests, items, tax lines, payments, certificates, `esali_sim_bills`) and the demo owners with their vehicles, instead of migrating them. The next startup reseeds the demo data. Other accounts and their vehicles are kept.
- `src/preload`: preload bridge (`index.ts`, types in `index.d.ts`). The renderer reaches the DB and main process only through this bridge.
- `src/renderer`: React UI
- Auto-updates via `electron-updater`, published to GitHub releases (`omeramyahya1/masarat`)

## Commands

- `npm run dev`: run in development
- `npm run typecheck`: typecheck the node and web projects
- `npm run lint` / `npm run format`
- `npm run build:linux` / `npm run build:win`: package the app

## Releasing

- Packaging config lives only in `electron-builder.yml`. Don't add a `build` key to `package.json`: electron-builder would read that instead and silently ignore the yml (including `extraResources: drizzle`, without which installed builds can't migrate).
- **To release**: commit everything, run `npm version patch` and `git push`, then `npm run release`. `scripts/tag-release.mjs` pushes the `v<version>` tag for the current commit. Nothing is built locally.
- **The tag starts `.github/workflows/release.yml`**:
  1. *prepare* creates the release as a **draft**.
  2. *build* runs the Linux AppImage (ubuntu) and the Windows installer and portable `.exe` (windows) in parallel. electron-builder uploads them into the draft (`releaseType: draft` in `electron-builder.yml`).
  3. *publish* checks that all 5 files are attached (`AppImage`, `latest-linux.yml`, `-setup.exe`, `-portable.exe`, `latest.yml`), then publishes.

  Publishing is what triggers the release notification (Slack), so it only goes out once every download exists. Don't publish the draft by hand.
- **If a run fails**: fix the problem, then Actions → *Release* → *Run workflow* with the tag. It reuses the draft. If the fix needs new code, bump the version instead.
- electron-updater reads `latest-linux.yml` / `latest.yml` from the latest published release.

## Guidelines

- Mock or simulate external systems (E-Sali, Bankak/banks) behind clear interfaces so they can be swapped for real integrations later.
- Keep the demo flow smooth and visually credible for a government audience.
- This context will evolve. Update this file as requirements are clarified.
