// The export queue, in Redis: the API queues exports and answers their status; the export worker
// (src/exportWorker.ts) takes them one by one and builds the files. At most as many exports are
// prepared at once, across every worker, as there are active government admins and supervisors
// (exportConcurrency); the rest wait in line, first come first served.
//
// Keys (all under `exports:`):
//   job:<id>       the job, as JSON (24 h; an hour once finished, as long as its file is kept)
//   queue          the ids waiting, oldest first (a list)
//   running        the ids being prepared, each scored with its lease's expiry (a sorted set)
//   active:<user>  the account's export in progress: one at a time
//   last:<user>    the account's latest export, so the dialog can pick it up again
//   cancel:<id>    asked to stop while being prepared: the worker throws its result away
//
// A worker renews its lease while it works. If it dies, the lease runs out and the next claim marks
// the job failed (export_failed) instead of leaving it in "preparing" for ever.
import { randomBytes } from 'crypto'
import { and, count, eq, inArray, isNull } from 'drizzle-orm'
import {
  EXPORT_FILE_TTL_MS,
  type ExportInput,
  type ExportJob,
  type ExportJobStatus,
  type ExportRows
} from '@masarat/shared/exports'
import { getDb, roles, users } from '../db'
import { getRedis } from './redis'

const DAY_S = 24 * 60 * 60
const FILE_TTL_S = Math.round(EXPORT_FILE_TTL_MS / 1000)
// The longest an export can stay "in progress" for its account, whatever happens to it
const ACTIVE_TTL_S = 6 * 60 * 60

export const exportKeys = {
  job: (id: string): string => `exports:job:${id}`,
  queue: 'exports:queue',
  running: 'exports:running',
  active: (userId: number): string => `exports:active:${userId}`,
  last: (userId: number): string => `exports:last:${userId}`,
  cancel: (id: string): string => `exports:cancel:${id}`
}

// What's kept for a job: the public view plus who asked, what for, and where its file is
export interface StoredExportJob extends Omit<ExportJob, 'ahead'> {
  ownerId: number
  input: ExportInput
  fileKey: string | null
}

// The object key of a finished export's file in the bucket
export const exportObjectKey = (id: string, fileName: string): string => `exports/${id}/${fileName}`

const TERMINAL: readonly ExportJobStatus[] = ['done', 'failed', 'cancelled']

async function readJob(id: string): Promise<StoredExportJob | null> {
  const raw = await getRedis().get(exportKeys.job(id))
  return raw ? (JSON.parse(raw) as StoredExportJob) : null
}

async function writeJob(job: StoredExportJob, ttlS: number): Promise<void> {
  await getRedis().send('SET', [exportKeys.job(job.id), JSON.stringify(job), 'EX', String(ttlS)])
}

// Deletes `key` only while it still holds `value` (an account's active export, once it's over)
const DELETE_IF_SCRIPT = `if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1]) end return 0`

async function releaseActive(job: StoredExportJob): Promise<void> {
  await getRedis().send('EVAL', [DELETE_IF_SCRIPT, '1', exportKeys.active(job.ownerId), job.id])
}

async function publicView(job: StoredExportJob): Promise<ExportJob> {
  let ahead: number | null = null
  if (job.status === 'queued') {
    const position = await getRedis().send('LPOS', [exportKeys.queue, job.id])
    ahead = typeof position === 'number' ? position : null
  }
  const { id, status, createdAt, startedAt, finishedAt, error, rows, fileName } = job
  return { id, status, ahead, createdAt, startedAt, finishedAt, error, rows, fileName }
}

// ---- The API's side ----

export type QueueResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'export_in_progress' | 'export_not_found' | 'export_not_ready' }

// Admits an export in one step: takes the account's slot unless an export of its is still waiting
// or being prepared, stores the job, makes it the account's latest and queues it. One script, so
// two requests at once can't both take the slot, and a job is never stored without being queued.
// KEYS: active, last, queue, the new job; ARGV: id, job JSON, the slot's and the job's TTL, and
// the job key's prefix (to read the slot's current job, whose key is only known here).
const ADMIT_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then
  local raw = redis.call('GET', ARGV[5] .. current)
  if raw then
    local status = cjson.decode(raw).status
    if status ~= 'done' and status ~= 'failed' and status ~= 'cancelled' then return 0 end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('SET', KEYS[4], ARGV[2], 'EX', ARGV[4])
redis.call('SET', KEYS[2], ARGV[1], 'EX', ARGV[4])
redis.call('RPUSH', KEYS[3], ARGV[1])
return 1`

// Queues an export for the account; one at a time per account
export async function queueExport(
  ownerId: number,
  input: ExportInput,
  now = Date.now()
): Promise<QueueResult<ExportJob>> {
  const id = randomBytes(12).toString('hex')
  const job: StoredExportJob = {
    id,
    ownerId,
    input,
    status: 'queued',
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    error: null,
    rows: null,
    fileName: null,
    fileKey: null
  }
  const admitted = await getRedis().send('EVAL', [
    ADMIT_SCRIPT,
    '4',
    exportKeys.active(ownerId),
    exportKeys.last(ownerId),
    exportKeys.queue,
    exportKeys.job(id),
    id,
    JSON.stringify(job),
    String(ACTIVE_TTL_S),
    String(DAY_S),
    exportKeys.job('')
  ])
  // An earlier export of this account is still waiting or being prepared
  if (admitted !== 1) return { ok: false, error: 'export_in_progress' }
  return { ok: true, data: await publicView(job) }
}

// The account's own export (another account's answers as not found)
async function ownJob(ownerId: number, id: string): Promise<StoredExportJob | null> {
  const job = await readJob(id)
  return job && job.ownerId === ownerId ? job : null
}

export async function exportStatus(ownerId: number, id: string): Promise<QueueResult<ExportJob>> {
  const job = await ownJob(ownerId, id)
  return job ? { ok: true, data: await publicView(job) } : { ok: false, error: 'export_not_found' }
}

// The account's latest export, if it's still kept (for the dialog, after it was closed)
export async function latestExport(ownerId: number): Promise<ExportJob | null> {
  const id = await getRedis().get(exportKeys.last(ownerId))
  const job = id ? await ownJob(ownerId, id) : null
  return job ? publicView(job) : null
}

// Stops the account's export: a queued one leaves the line; one being prepared is thrown away
// when the worker finishes it
export async function cancelExport(ownerId: number, id: string): Promise<QueueResult<ExportJob>> {
  const job = await ownJob(ownerId, id)
  if (!job) return { ok: false, error: 'export_not_found' }
  if (TERMINAL.includes(job.status)) return { ok: true, data: await publicView(job) }
  const redis = getRedis()
  const removed = await redis.send('LREM', [exportKeys.queue, '1', id])
  if (removed === 0) {
    // A worker has it: it checks this flag before publishing the file
    await redis.send('SET', [exportKeys.cancel(id), '1', 'EX', String(DAY_S)])
  }
  const cancelled: StoredExportJob = { ...job, status: 'cancelled', finishedAt: Date.now() }
  await writeJob(cancelled, FILE_TTL_S)
  await releaseActive(cancelled)
  return { ok: true, data: await publicView(cancelled) }
}

// A finished export's file, for its account
export async function exportFile(
  ownerId: number,
  id: string
): Promise<QueueResult<{ key: string; name: string; rows: ExportRows }>> {
  const job = await ownJob(ownerId, id)
  if (!job) return { ok: false, error: 'export_not_found' }
  if (job.status !== 'done' || !job.fileKey || !job.fileName) {
    return { ok: false, error: 'export_not_ready' }
  }
  return { ok: true, data: { key: job.fileKey, name: job.fileName, rows: job.rows ?? {} } }
}

// ---- The worker's side ----

// As many exports at once as there are active government admins and supervisors (at least one);
// EXPORT_CONCURRENCY, when set, replaces it
export async function exportConcurrency(override: number | null): Promise<number> {
  if (override !== null) return override
  const [row] = await getDb()
    .select({ n: count() })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(
      and(
        eq(users.kind, 'govt'),
        isNull(users.disabledAt),
        inArray(roles.key, ['govt_admin', 'govt_supervisor'])
      )
    )
  return Math.max(1, row?.n ?? 0)
}

// Takes the next export when fewer than `limit` are being prepared, with a lease of `leaseMs`.
// Leases that ran out (a worker that died) are handed back as `expired`.
const CLAIM_SCRIPT = `
local expired = redis.call('ZRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
if #expired > 0 then redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1]) end
local id = false
if redis.call('ZCARD', KEYS[2]) < tonumber(ARGV[3]) then
  id = redis.call('LPOP', KEYS[1])
  if id then redis.call('ZADD', KEYS[2], tonumber(ARGV[1]) + tonumber(ARGV[2]), id) end
end
local out = { id or '' }
for _, e in ipairs(expired) do table.insert(out, e) end
return out`

export async function claimExport(
  limit: number,
  leaseMs: number,
  now = Date.now()
): Promise<{ job: StoredExportJob | null; expired: string[] }> {
  const reply = (await getRedis().send('EVAL', [
    CLAIM_SCRIPT,
    '2',
    exportKeys.queue,
    exportKeys.running,
    String(now),
    String(leaseMs),
    String(limit)
  ])) as string[]
  const [id, ...expired] = reply
  for (const lost of expired) {
    const job = await readJob(lost)
    if (job && !TERMINAL.includes(job.status)) await finishExport(job, { error: 'export_failed' })
  }
  if (!id) return { job: null, expired }
  const job = await readJob(id)
  if (!job || job.status !== 'queued') {
    // Gone (expired) or cancelled meanwhile: nothing to prepare
    await getRedis().send('ZREM', [exportKeys.running, id])
    return { job: null, expired }
  }
  const running: StoredExportJob = { ...job, status: 'running', startedAt: now }
  await writeJob(running, DAY_S)
  return { job: running, expired }
}

// Extends the lease; false when it had run out and the job was given up (stop working on it)
export async function renewLease(id: string, leaseMs: number, now = Date.now()): Promise<boolean> {
  const changed = await getRedis().send('ZADD', [
    exportKeys.running,
    'XX',
    'CH',
    String(now + leaseMs),
    id
  ])
  return changed === 1
}

export async function isCancelled(id: string): Promise<boolean> {
  return (await getRedis().exists(exportKeys.cancel(id))) === true
}

// Writes a job's outcome only while it hasn't ended: an export cancelled meanwhile, or given up as
// failed when its lease ran out, keeps that status (one script, so the check and the write can't
// be split by a cancel). Still 'queued' is a job whose worker died between claiming it and
// marking it running: its lease's expiry fails it. KEYS: the job; ARGV: its new JSON, its TTL.
const FINISH_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local status = cjson.decode(raw).status
if status ~= 'running' and status ~= 'queued' then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
return 1`

// Records how the export ended, frees its place among those being prepared and its account's slot.
// False when the job had already ended otherwise (cancelled, or failed by a lost lease): its
// outcome stays as it was.
export async function finishExport(
  job: StoredExportJob,
  outcome:
    | { file: { key: string; name: string }; rows: ExportRows }
    | { error: NonNullable<ExportJob['error']>; rows?: ExportRows }
): Promise<boolean> {
  const ended: StoredExportJob =
    'file' in outcome
      ? {
          ...job,
          status: 'done',
          finishedAt: Date.now(),
          rows: outcome.rows,
          fileName: outcome.file.name,
          fileKey: outcome.file.key
        }
      : {
          ...job,
          status: 'failed',
          finishedAt: Date.now(),
          error: outcome.error,
          rows: outcome.rows ?? null
        }
  const written = await getRedis().send('EVAL', [
    FINISH_SCRIPT,
    '1',
    exportKeys.job(job.id),
    JSON.stringify(ended),
    String(FILE_TTL_S)
  ])
  await getRedis().send('ZREM', [exportKeys.running, job.id])
  if (written !== 1) return false
  await releaseActive(ended)
  return true
}

// Gives a cancelled export's place back once its worker has stopped on it
export async function dropCancelled(job: StoredExportJob): Promise<void> {
  await getRedis().send('ZREM', [exportKeys.running, job.id])
  await getRedis().del(exportKeys.cancel(job.id))
}
