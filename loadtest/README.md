# Load test

Finds the hardware Masarat needs in production. The test loads the API and Postgres with the national workload, at several server sizes and with production-sized tables, and records where each size stops meeting the SLOs.

## The workload (SCALE=1)

The targets: **5,000–20,000 trips a day**, **1,000–5,000 users online**, and **10–100 checkpoint scans a second**. SCALE=1 is the top of each range. SCALE=0.25 and 0.5 are 5,000 and 10,000 trips a day. Every rate is in `TARGET` in `k6/mixed.js`.

| Flow (`k6/flows.js`)                                                                                                          | At SCALE=1                                        | Where it comes from                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `booking`: a clerk books a trip and takes it to the authorized manifest                                                       | 51 trips a minute (0.85/s), about 9 requests each | 20,000 trips a day, 15% of them in the peak hour. A third of cargo trips also attach an invoice and a packing list of 1 MB each. |
| `browse`: members follow their trips (lists, filters, groups, search, a trip, vehicles, drivers)                              | 140 page views a second                           | 5,000 members online, one page view every ~35 s. 4 in 5 are clerks (their branch), 1 in 5 accountants (the whole company).       |
| `govtDashboard`: a senior opens the dashboard (history and today) or refreshes it (today only)                                | 5 a minute                                        | 5 senior government staff, each about once a minute; a new view 3 times in 10                                                    |
| `govtReview`: an agent searches (this week's trips 9 times in 10), opens a trip, and a third of the time one of its documents | 95 a minute                                       | 95 government agents, each about once a minute (100 government staff in all)                                                     |
| `exportData`: a month of trips and bills as Excel                                                                             | 1 a minute                                        |                                                                                                                                  |
| `verify`: a QR scan at a checkpoint                                                                                           | 100 a second                                      | Every trip scanned at 3–5 checkpoints, mostly in the morning. 9 in 10 scans are valid documents, 1 in 10 expired.                |
| `login`: a fresh sign-in (Argon2id)                                                                                           | 6 a second                                        | The shift-start rush: 5,000 sign-ins in 15 minutes. Not in the mixed run by default; run it on its own with `FLOWS=login`.       |

**The data.** The tables are seeded at production size, because the dashboard, the search and the lists slow down as they grow. Production keeps a month of history, so the seeder fills 30 days (`--days`). At 20,000 trips a day, with 10% of trips by bus (`--bus-share`), that comes to:

- 600k trips
- about 1.4M cargo items
- about 2.6M passengers (2,000 bus trips a day with ~43 passengers each), who are about 1M people: passengers travel again, about 2.5 trips each in the month, the frequent travellers more often (`--people` sets the pool)
- about 2.4M tax lines, and a payment and a certificate for almost every trip

**The SLOs** are the k6 thresholds in `k6/lib.js`. Every run reports each endpoint's p95 too.

| Kind                                     | p95      |
| ---------------------------------------- | -------- |
| read                                     | < 500 ms |
| write (save, bill, pay, refresh, upload) | < 1 s    |
| login                                    | < 1 s    |
| verify                                   | < 300 ms |
| dashboard                                | < 3 s    |
| export                                   | < 15 s   |

On top of that, errors must stay under 0.1% and checks above 99.9%.

## How the stack runs

`stack.sh` runs a Postgres 18 container named `masarat_load_db`, on port 5434 with the volume `masarat-load-pg`. It is separate from the dev database. Its settings are sized to its memory, and `pg_stat_statements` is on. The API runs natively on port 3100. It has demo mode on, for the simulated payment, and `TRUST_PROXY=true`, so k6 can give every virtual user its own IP and the per-IP limits behave as they would with many real clients.

**Server size = pinned CPUs.** Rootless podman on this machine can't limit CPU time; only memory and pids are delegated to the user's cgroup. So a server's size is the set of CPUs it is pinned to with `taskset`; memory is a real cgroup limit. The layout on this machine (i7-12800H):

| CPUs  | Hardware                                | Used by                      |
| ----- | --------------------------------------- | ---------------------------- |
| 0–11  | the 6 performance cores, 2 threads each | API on 0–3, Postgres on 4–11 |
| 12–19 | the 8 efficiency cores                  | k6                           |

**Laptop cores aren't cloud cores.** They run at up to 4.7 GHz, while a cloud vCPU is typically 2.5–3.5 GHz. A size that passes here needs about **1.5×** the vCPUs in the cloud. Confirm the chosen size once on a real VM before ordering hardware.

**Run as production runs.** The load API connects as the least-privileged `masarat_app` role (the seeder and migrations as the owner), keeps upload staging and rate limits in Redis (`redis://localhost:6380/1`), attachments in MinIO (`masarat-load` bucket), and writes its JSON logs (info level) to `loadtest/.state/logs`, so the measured cost includes logging. Cargo trips are seeded with 1–3 attachment rows pointing at one shared sample object: the storage itself (2–6 TB a month at these volumes) is sized by arithmetic in `docs/deployment/sizing.md` and tested on the real server.

## Running it

k6 is a single binary, from https://github.com/grafana/k6/releases. Put it on the PATH or at `~/.local/bin/k6`.

```sh
# 1. Services, database and data (a month at 20,000 trips a day: ~5 minutes, ~3 GB)
loadtest/stack.sh services-up          # Redis and MinIO (compose.yaml) and the masarat-load bucket
loadtest/stack.sh db-up 4-11 4g
loadtest/stack.sh migrate
taskset -c 12-19 loadtest/stack.sh seed --trips-per-day 20000 --days 30 --bus-share 0.1

# 2. Smoke test: every flow, briefly, with no errors
loadtest/stack.sh api-up 0-1 20
(cd loadtest/k6 && k6 run -e SCALE=0.05 -e DURATION=30s -e FLOWS=booking,browse,govtDashboard,govtReview,exportData,verify,login mixed.js)

# 3. One size at the target load, or a series of loads until it fails
loadtest/run.sh api2-db4 0-1 4-7 8g 20 1
loadtest/run.sh knee api2-db4 0-1 4-7 8g 20 "0.5 1 1.5 2 3"

# 4. One flow on its own (what saturates first?)
loadtest/run.sh verify-only 0-1 4-7 8g 20 1 3m verify

# 5. Soak: the target for 3 hours (memory growth, sessions, Redis, the log files)
loadtest/run.sh soak 0-1 4-7 8g 20 1 3h

# New k6 data files (users, lookups by age) from data already seeded, without reseeding
loadtest/stack.sh seed --data-only

# The table of every run so far
bun loadtest/summarize.ts

# Stop (the data stays), or remove everything
loadtest/stack.sh down
loadtest/stack.sh wipe
```

Arguments of `run.sh`: label, API CPUs, Postgres CPUs, Postgres memory, the API's pool size (`DB_POOL_MAX`), the scale, then optionally the duration and the flows. Results go to `loadtest/results/<label>/scale-<scale>/` (gitignored); see the top of `run.sh`.

The seeder (`apps/api/src/scripts/loadSeed.ts`) refuses any database whose name doesn't contain "load". It also seeds the demo companies, and writes the users and the lookup values the k6 scripts read into `loadtest/data/`. Everyone the test signs in as has the password `load2026`. Trips booked during the tests stay in the database; reseed (`wipe`, then step 1) to start clean.

## Results

The first run (24 Nov 2026) found six application problems. Branch `scale-fixes` fixes them: the missing indexes, the dashboard's daily summary, streamed exports, trip lists without joins, indexed government search capped at 1,000, and time limits.

The tests were not run again after those fixes. Before the next run:

- `loadtest/stack.sh migrate` adds migrations 0006 and 0007 to the seeded database. That takes a while on 37 GB.
- Drop the six `lt_*` indexes added by hand during the first run; the migration creates its own.

See the sizing report for the latest numbers. Rerun the matrix before a release that touches the dashboard, the trip queries or billing.
