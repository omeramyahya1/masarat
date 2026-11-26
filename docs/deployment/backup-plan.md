# Backup plan (draft)

A draft to settle with the agency before go-live. The numbers come from the agreed volumes (20,000 trips a day, 10% by bus, 1–3 attachments of about 2 MB per cargo trip; [sizing.md](sizing.md)) and from the decision to take **daily backups**.

## What the decision means

|                                | Daily backups (decided)                                                                                                                                                                                                                        | Daily backups + WAL archiving (recommended)                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **RPO**: data that can be lost | **up to 24 hours**: every trip booked, bill issued and payment confirmed since the last backup                                                                                                                                                 | **a few minutes**: Postgres replays its write-ahead log up to the failure |
| What a loss means              | A day's payments recorded in Masarat but gone from it. E-Sali still has them, so they can be re-confirmed bill by bill, but receipts and manifests issued that day must be issued again, and officers may scan QR codes that no longer verify. | Practically none                                                          |
| Extra cost                     | none                                                                                                                                                                                                                                           | WAL storage (about the day's write volume), and one setting               |

**The recommendation is to add WAL archiving.** It costs little, and it changes the worst case from "a day of tax payments to reconstruct" to "a few minutes". If the decision stays at daily only, the agency should accept the 24-hour RPO in writing.

## What is backed up

| Data                                  | Size (at the agreed volumes)                  | How                                                                                                                                                                                       | Kept                                                                                                  |
| ------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Postgres**: live tables (one month) | about 2–4 GB with indexes                     | Daily base backup (`pg_basebackup`, or pgBackRest / WAL-G), compressed, to storage in another location. With WAL archiving, the WAL is shipped continuously                               | Daily backups for 14 days, a weekly one for 3 months, a monthly one for the retention the agency sets |
| **Postgres**: archive schema          | grows by about 2–4 GB a month (uncompressed)  | In the same backup (same database)                                                                                                                                                        | As above                                                                                              |
| **MinIO**: attachments                | **72–216 GB a day, about 2.2–6.5 TB a month** | Bucket replication (`mc replicate`) to a second MinIO in another location, or a nightly `mc mirror` (incremental: only the day's new objects). Versioning on, so a deletion can be undone | As long as the trips they belong to (the legal period)                                                |
| **Redis**                             | small, temporary                              | Not backed up. Losing it costs at most an upload to redo and a rate-limit window                                                                                                          | —                                                                                                     |
| **Configuration and secrets**         | small                                         | In the platform's secret store, which has its own backup                                                                                                                                  | —                                                                                                     |
| **Logs**                              | 7 days on each instance                       | On the log platform, with its own retention                                                                                                                                               | 30–90 days (to agree)                                                                                 |

The attachments are the real backup volume, roughly a thousand times the database. They decide the backup storage. Attachment throughput and storage are tested on the real server before deployment.

## RTO: how long a recovery takes

The RTO is measured, not assumed: a **restore drill** before go-live, then every quarter.

| Failure                                                          | Recovery                                                                                     | Expected time                                                                                                  |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| An API instance dies                                             | The load balancer routes around it; the orchestrator starts a new one                        | minutes, without downtime (2 instances)                                                                        |
| The Postgres primary dies                                        | Promote the standby (streaming replication); point the API at it                             | minutes                                                                                                        |
| Data damaged by mistake (a bad migration, a wrong manual change) | Point-in-time restore to just before it (needs WAL archiving); otherwise last night's backup | **To measure.** At 4–8 GB the restore itself takes minutes; most of the time is checking                       |
| Both database servers lost                                       | Restore the latest base backup (and WAL) on a new server                                     | **To measure.** Probably under an hour for the database                                                        |
| The MinIO site lost                                              | Switch to the replica, or restore from the mirror                                            | **To measure.** Copying terabytes back takes hours; with replication the API is pointed at the replica instead |

**A proposed target** (to confirm after the drill): RTO 1 hour for the database and the API; attachments read from the replica at once, with the primary rebuilt in the background.

## Procedures to write and rehearse

1. **Restore Postgres to a point in time**, into a new server: commands, checks (`/health/ready`, row counts against the backup's report, a trip's page, a verify link), and switching the API over.
2. **Promote the standby.**
3. **Restore attachments**, or switch MinIO to the replica.
4. **After a restore with data loss (the 24-hour RPO):**
   1. List the bills E-Sali reports paid that Masarat no longer has.
   2. Re-confirm them.
   3. Tell the companies which documents to print again.

## Decisions needed

- [ ] Daily only, or daily with WAL archiving (recommended)
- [ ] The RTO target
- [ ] How long backups are kept, aligned with the legal retention of tax records
- [ ] Where the second location is: another data center, or the agency's own site
