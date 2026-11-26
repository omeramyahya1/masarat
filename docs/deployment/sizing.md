# Sizing (in progress)

The resources Masarat needs at the agreed volumes. **Status: partial.** These sections are measured on the laptop (`loadtest/`, results in `loadtest/results/v5-*`):

- the data volume
- browsing at the target load
- the government flow at reduced rates

The full matrix is still to run: the mixed load at several database sizes, two API instances, and a soak. The final figures must be confirmed once on a real server (laptop cores are faster than cloud vCPUs, roughly 1.5×).

## The agreed volumes

| Item                                              | Per day                       | Per month (the live window)     |
| ------------------------------------------------- | ----------------------------- | ------------------------------- |
| Trips (10% buses)                                 | 20,000                        | 600,000                         |
| Cargo items                                       | ~45,000                       | ~1.4M                           |
| Passenger rows / people                           | ~86,000                       | ~2.6M rows, ~0.9M people        |
| Attachments (18k cargo trips × 1–3 files × ~2 MB) | 36k–108k files, **72–216 GB** | **1.1M–3.2M files, 2.2–6.5 TB** |

The seeded month (`loadtest/stack.sh seed --trips-per-day 20000 --days 30 --bus-share 0.1`) produced:

- 622k trips, 1.4M cargo items, 2.65M passenger rows, 908k people
- 1.04M attachment rows, 2.5M tax lines, 578k certificates

It came to **2.9 GB of database** with indexes. The live tables stay at about this size; the archive grows by about this much a month.

## Measured so far

**Browsing at the target** (5,000 members online, 140 page views a second; API on 2 cores, Postgres on 8 cores with 4 GB):

|                 | Result                                                                                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Errors          | **0%** (the run before the fixes: 33%)                                                                                                                                                              |
| Reads p95       | **462 ms** (target < 500 ms)                                                                                                                                                                        |
| Trip page p95   | 1.1 s                                                                                                                                                                                               |
| API CPU         | **0.6–0.8 cores**, with every request logged as JSON                                                                                                                                                |
| Postgres CPU    | **~2.5 cores** of 8                                                                                                                                                                                 |
| Postgres memory | ~2.3 GB                                                                                                                                                                                             |
| Login           | p95 19.6 s, but only because the test logs in every simulated user in the same second (Argon2id on 2 cores). A real shift start (5,000 sign-ins in 15 minutes, ~6 a second) needs about half a core |

**The government dashboard is the cost driver.**

- A filtered dashboard is about fifteen queries over the month's payments, roughly **5–10 Postgres core-seconds per visit**.
- At the assumed rate (2 dashboard visits a second, a third of them filtered) it saturates 8 cores. At a tenth of that rate, Postgres averages under 2 cores.
- Since these runs:
  - the dashboard's queries run concurrently, so its latency is its slowest query instead of the sum
  - computed dashboards are reused from Redis for 60 s
  - neither has been measured yet
- The `all_*` views (live and archived trips) make a filtered query about 2.4× more expensive than the live table alone.

**The government workload is the weakest assumption.** "300 government staff online" was my estimate, not an agreed figure. It decides most of the database size, so it should be confirmed with the agency.

## Provisional sizes

| Role                         | Size                                                                                               | Basis                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| API                          | 2 instances × 2 vCPU, 4 GB                                                                         | Under 1 core at the target browsing load; 2 instances for availability                  |
| Postgres (primary + standby) | 8 vCPU, 16 GB RAM, 100 GB SSD for the live month, plus the archive's disk                          | 2.5 cores for browsing; the rest is government dashboards, depending on their real rate |
| Archive storage              | ~3 GB a month of database, plus indexes                                                            | Grows with retention (the agency's legal period)                                        |
| Redis                        | 1 vCPU, 1 GB                                                                                       | Tokens, rate-limit windows, cached dashboards                                           |
| MinIO / object storage       | **2.2–6.5 TB a month** at peak volume, ×1.5 for erasure coding, and the same again for the replica | The largest cost by far; set the retention for attachments                              |
| Monitoring and logs          | 2 vCPU, 8 GB, 200 GB                                                                               | Prometheus, Grafana, Loki                                                               |

## To finish

1. Rerun the government flow with the concurrent queries and the cache, at the assumed rate and at a confirmed one.
2. Run the mixed load (booking, browsing, government, exports, verification) at Postgres 8, 4 and 2 cores, and once with 2 API instances.
3. Run a soak of a few hours for memory growth.
4. Confirm the sizes on one real VM, including attachment upload throughput.
