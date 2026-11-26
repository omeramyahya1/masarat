# End-to-end scenarios

What a person does with Masarat, as scenarios and cases, from sign-in to the checkpoint. Each case has an id; the Playwright spec that automates it carries the same id in its title (`e2e/tests/`). Cases marked **manual** need a person (printing, a phone's camera) or an external system that is still simulated.

**How they run.** `bun run db:up`, then `bun run e2e` from the repo root:

- **A stack of its own.** The run uses its own ports (API 3200, site 5275, company portal 5273, government portal 5274) and its own database, `masarat_e2e`, which is dropped, migrated and reseeded with the demo data each run. Development data is never touched.
- **The browser and language.** The tests run in Chromium with the English interface (one case checks Arabic).
- **Results.** A run leaves an HTML report in `e2e/report/`. A failed case also keeps a trace and a screenshot, in `e2e/results/`.

**The data.** The demo companies and accounts (CLAUDE.md, _Demo accounts_): `nile.transport` (company admin), `nile.clerk1` (a branch clerk), `nile.accountant`, `ministry.demo` (the government admin) and `ministry.agent`. Cases that need a trip in a particular state create it through the API as the member would, then check it in the browser.

## Sessions and access (AUTH)

| Id      | Case                       | Steps                                                                      | Expected                                                                                  |
| ------- | -------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| AUTH-01 | A company admin logs in    | Open masarat.com/login, enter `nile.transport` / `nile2026`                | Lands on the company portal, Trips section, with their name and company in the user bar   |
| AUTH-02 | A government user logs in  | Log in as `ministry.agent`                                                 | Lands on the government portal's Overview                                                 |
| AUTH-03 | Wrong password             | Log in with a wrong password                                               | "Invalid username or password" (the same as an unknown username); stays on the login page |
| AUTH-04 | A portal without a session | Open the company portal directly, signed out                               | Sent to masarat.com/login with `next` set; after logging in, back to the portal           |
| AUTH-05 | The wrong portal           | Signed in as a company member, open the government portal                  | Sent to the company portal                                                                |
| AUTH-06 | A temporary password       | The admin creates a member; the member logs in with the temporary password | Sent to change their password first; then the portal opens                                |
| AUTH-07 | Logging out                | Log out from the user bar                                                  | Back on masarat.com; the portal asks for a login again                                    |
| AUTH-08 | Arabic by default          | Open the login page without a language cookie                              | The page is in Arabic, right to left                                                      |

## Company admin (ADM)

| Id     | Case              | Steps                                   | Expected                                                           |
| ------ | ----------------- | --------------------------------------- | ------------------------------------------------------------------ |
| ADM-01 | Sign up a company | Register a company with its admin       | Signed in as its admin, on an empty Trips list                     |
| ADM-02 | Company details   | Profile: change the address             | Saved                                                              |
| ADM-03 | Add a branch      | Branches: add a branch in a city        | It appears in Branches, and in the trip form's branch list         |
| ADM-04 | A custom role     | Roles: add a role with some permissions | It can be given to a member in Team                                |
| ADM-05 | Add a member      | Team: add a clerk at a branch           | A temporary password is shown once; the member appears in the list |
| ADM-06 | Disable a member  | Team: disable the member                | They're signed out; their login says the account is disabled       |

## Clerk: cargo trips (CRG)

| Id     | Case                           | Steps                                                                                       | Expected                                                                           |
| ------ | ------------------------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| CRG-01 | Book a cargo trip              | Trips → New trip: vehicle, driver, route, times, sender and receiver, one item with packing | Saved as a draft; the trip page shows the trip cost and the taxes and fees         |
| CRG-02 | Missing details block the bill | A draft without a driver: _Generate bill ID_                                                | The page lists what's missing; no bill is issued                                   |
| CRG-03 | Bill, pay, authorize           | Generate bill ID, pay it (demo menu), _Refresh status_                                      | Pending payment, then Authorized; the receipt and manifest open with their numbers |
| CRG-04 | Attach a document              | Attach a commercial invoice (PDF) to a draft and save                                       | It's listed and opens in the in-page preview                                       |
| CRG-05 | Edit and delete a draft        | Edit a draft's item, then delete it                                                         | The edit shows; after deleting, the trip is gone from the list                     |
| CRG-06 | A bill is final                | Open an authorized trip                                                                     | No edit or delete; the bill's lines don't change                                   |
| CRG-07 | Print the documents            | _Show / download receipt and manifest_ → print                                              | **Manual**: A4 pages with the letterhead, barcode and QR                           |

## Clerk: passenger trips (PSG)

| Id     | Case            | Steps                                          | Expected                                                 |
| ------ | --------------- | ---------------------------------------------- | -------------------------------------------------------- |
| PSG-01 | Book a bus trip | A bus, a route, passengers with IDs and seats  | Saved; the ticket price and fares follow the seats       |
| PSG-02 | A seat twice    | Two passengers on the same seat                | Refused: the seat is taken                               |
| PSG-03 | An infant       | An infant on a passenger's seat, without an ID | Accepted; no ticket for the infant                       |
| PSG-04 | From a template | _From a template_                              | The form opens with the template's route, bus and driver |

## The trips list (LST)

| Id     | Case                   | Steps                                         | Expected                                                        |
| ------ | ---------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| LST-01 | One month at a time    | Open Trips; previous month; next month        | The list covers the month shown; the counts change with it      |
| LST-02 | A custom period        | Pick a range of up to 92 days                 | The list covers it; a longer one is refused                     |
| LST-03 | Whole names only       | Search a sender's whole name; then part of it | The whole name finds its trips; part of it finds nothing        |
| LST-04 | Group and filter       | Group by status; filter by vehicle            | Group headers with counts and totals; only that vehicle's trips |
| LST-05 | A branch clerk's scope | Log in as `nile.clerk1`                       | Only their branch's trips; no branch filter or group            |

## Accountant (ACC)

| Id     | Case                           | Steps                       | Expected                                                                                  |
| ------ | ------------------------------ | --------------------------- | ----------------------------------------------------------------------------------------- |
| ACC-01 | Sees and bills, doesn't manage | Log in as `nile.accountant` | Trips, Vehicles and Drivers to view; no Team, Branches or Roles; vehicles can't be edited |

## Government (GOV)

| Id     | Case                         | Steps                                                                                      | Expected                                                                                        |
| ------ | ---------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| GOV-01 | The dashboard                | Log in as `ministry.agent`                                                                 | Revenue collected, collection rate, the revenue chart and the breakdown, for the last 30 days   |
| GOV-02 | Filters                      | Change the period and add a filter                                                         | The figures follow; leaving for another section and coming back keeps the filters               |
| GOV-03 | Search                       | Search a city name; open a result; go back                                                 | The results, then the trip read-only (company, branch, who booked it); back to the same results |
| GOV-04 | Search by bill ID and number | Search a trip's E-Sali bill ID, then its MNF- number                                       | That trip is found each time                                                                    |
| GOV-05 | Export data                  | Export passengers as CSV, with and without their IDs (through the API, as the dialog does) | The ID column only when asked for                                                               |
| GOV-06 | The report                   | Export → Report (PDF)                                                                      | **Manual** (printing): the preview opens with the letterhead                                    |
| GOV-07 | Taxes and fees               | As `ministry.demo`: open Taxes and fees                                                    | The charges are listed (editing them is covered by the API tests, `apps/api/test/govt.test.ts`) |
| GOV-08 | Settings                     | As `ministry.demo`: change the validity margin                                             | Saved                                                                                           |
| GOV-09 | One government admin         | As `ministry.demo`: Users → add an account                                                 | The government admin role isn't offered                                                         |
| GOV-10 | An agent's limits            | As `ministry.agent`                                                                        | No Taxes and fees, Settings or Users                                                            |

## The verify page (VER)

| Id     | Case                | Steps                                             | Expected                                                                 |
| ------ | ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------ |
| VER-01 | A valid manifest    | Open an authorized trip's verify link, signed out | "Valid manifest", with the numbers, plate and route, and no names or IDs |
| VER-02 | An unknown code     | Open /verify/ with a made-up code                 | "No manifest found"                                                      |
| VER-03 | An expired manifest | Open a verify link of a trip past its validity    | "Expired manifest"                                                       |
| VER-04 | Scanning the QR     | Scan the printed QR with a phone                  | **Manual**: the same page opens                                          |

## Caching (CCH)

| Id     | Case                       | Steps                                               | Expected                                                                 |
| ------ | -------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------ |
| CCH-01 | Sections don't refetch     | Trips → Vehicles → Drivers → Trips, within a minute | No new requests to the API after the first visit to each                 |
| CCH-02 | A change updates the lists | Add a driver                                        | The Drivers list shows them at once, and the trip form's driver list too |
| CCH-03 | Pages seen before          | Previous month, then back to the current one        | No request for the month already seen                                    |

## The archive (ARC)

| Id     | Case                            | Steps                                                                                                                                                 | Expected                                                           |
| ------ | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| ARC-01 | An archived trip is still found | Move the month-old finished trips to the archive (`bun run --filter @masarat/api trips:archive`); open an older month in Trips; open one of its trips | The trips are listed; the trip opens read-only, marked as archived |
| ARC-02 | The government finds it         | Search the archived trip's number                                                                                                                     | Found, and opens                                                   |
