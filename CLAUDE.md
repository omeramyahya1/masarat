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
- **Tax** (`src/shared/tax.ts`): `rate_per_km × distance_km × quantity / per_quantity`. Distance is the haversine distance between the cities × a 1.3 road factor (an estimate until real routing exists). The main process recomputes the tax on save; the renderer's preview is never trusted.
- Cargo is measured in its tax rate's unit, which must match the vehicle's capacity unit (e.g. fuel → liters → tanker). New trips are saved as `draft` manifests.

## Billing & certificates rules

- **Flow** (`src/main/services/billing.ts`, UI in `components/trips/TripDetails.tsx`): `draft` → *Generate bill ID* → `billed` (shown as "Pending payment") → the user pays the bill ID from any banking app → *Refresh status* → once E-Sali reports it paid, the payment is recorded, the certificate is issued and the manifest becomes `certified`. Our `payments` row only changes on refresh.
- **E-Sali bill ID** (`src/shared/billing.ts`): `yyyy` `mm` `0dd` (day as 3 digits) + 13 random digits = 22 digits, e.g. `2026110170000123456789`. One bill per manifest; generating again returns the existing bill.
- **E-Sali is simulated** behind the `EsaliGateway` interface in `src/main/services/esali.ts`. The mock keeps E-Sali's side in the `esali_sim_bills` table (simulation only; drop it with the real API). The hidden "⋯ → Pay <billId>" menu on a pending trip marks the bill paid at E-Sali.
- **Certificate**: number `MSR-<yyyy>-<manifestId 6 digits>`, valid until the end of trip date + 30 days. Always rendered in Arabic (`i18n.getFixedT('ar')` + `createFormatters`), with the Sudan emblem (`assets/sudan-emblem.svg`, Wikimedia Commons). *Download PDF* uses `webContents.printToPDF`; the `@media print` rules in `main.css` print only `.print-certificate`.
- **QR payload** (`buildQrPayload`): JSON `{"esaliBillId","status":"paid","plate"}`. Later it should become a URL to a page showing the manifest's status (looked up by `certificates.qr_token`).

## Tech stack

- Electron + electron-vite, React 19, TypeScript
- `src/main`: Electron main process (`src/main/index.ts`)
- `src/main/db`: local database layer using **SQLite (better-sqlite3) + Drizzle ORM** (`schema.ts`, `client.ts`). The Drizzle config is in `drizzle.config.ts` and migrations go to `./drizzle`.
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
- `npm version patch`, then `GH_TOKEN=<token> npm run release:linux`. `scripts/tag-release.mjs` pushes the `v<version>` tag for the current commit, then the AppImage is built and published as a GitHub release.
- Publishing the release triggers `.github/workflows/release-windows.yml`, which builds the NSIS installer and portable `.exe` from the same tag and uploads them to that release. electron-updater reads `latest-linux.yml` / `latest.yml` from the latest release.

## Guidelines

- Mock or simulate external systems (E-Sali, Bankak/banks) behind clear interfaces so they can be swapped for real integrations later.
- Keep the demo flow smooth and visually credible for a government audience.
- This context will evolve. Update this file as requirements are clarified.
