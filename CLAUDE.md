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

## Guidelines

- Mock or simulate external systems (E-Sali, Bankak/banks) behind clear interfaces so they can be swapped for real integrations later.
- Keep the demo flow smooth and visually credible for a government audience.
- This context will evolve. Update this file as requirements are clarified.
