// The API's log: JSON lines (pino), one object per event, with a level, an ISO time, the instance
// and, inside a request, its request id, so every line a request causes can be found together.
//
// Where it goes: stdout (the host or container collects it; pretty-printed in development) and a
// file per day under LOG_DIR (api-<instance>.<date>.<n>.log), deleted after LOG_RETENTION_DAYS (7).
// Secrets and personal data (passwords, cookies, session tokens, ID numbers) are redacted.
//
//   log.info('Demo data seeded', { companies: 4 })
//   log.error('Purging sessions failed', err)
//   log.warn('Slow export', { rows }, err)
import { AsyncLocalStorage } from 'node:async_hooks'
import { readdirSync, statSync, unlinkSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import pino, { type DestinationStream, type Logger } from 'pino'
import pinoRoll from 'pino-roll'
import { config } from './config'

type Fields = Record<string, unknown>

// The instance, so lines from several API servers can be told apart
export const instance = process.env.INSTANCE_NAME || hostname()

// Never written out, wherever they appear in a logged object
const REDACT = [
  'password',
  'newPassword',
  'currentPassword',
  'temporaryPassword',
  'passwordHash',
  'token',
  'idNumber',
  'cookie',
  'authorization',
  '*.password',
  '*.newPassword',
  '*.currentPassword',
  '*.temporaryPassword',
  '*.passwordHash',
  '*.token',
  '*.idNumber',
  '*.cookie',
  '*.authorization',
  'headers.cookie',
  'headers.authorization',
  'passengers[*].idNumber'
]

async function streams(): Promise<DestinationStream> {
  const out: pino.StreamEntry[] = []
  if (config.log.pretty) {
    const { default: pretty } = await import('pino-pretty')
    out.push({
      level: 'trace',
      stream: pretty({ translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,instance,env' })
    })
  } else out.push({ level: 'trace', stream: pino.destination({ fd: 1, sync: false }) })
  if (config.log.dir && process.env.NODE_ENV !== 'test') {
    const file = await pinoRoll({
      file: join(config.log.dir, `api-${instance}`),
      frequency: 'daily',
      dateFormat: 'yyyy-MM-dd',
      extension: '.log',
      mkdir: true
    })
    out.push({ level: 'trace', stream: file })
  }
  return pino.multistream(out)
}

// Tests keep the log quiet unless LOG_LEVEL asks otherwise
const level = process.env.NODE_ENV === 'test' ? process.env.LOG_LEVEL || 'silent' : config.log.level

export const rootLogger: Logger = pino(
  {
    level,
    base: { instance, env: config.appEnv },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
    redact: { paths: REDACT, censor: '[redacted]' },
    serializers: { err: pino.stdSerializers.err }
  },
  await streams()
)

// The logger of the request being handled (with its request id), when there is one
const current = new AsyncLocalStorage<Logger>()

export const runWithLogger = <T>(logger: Logger, fn: () => T): T => current.run(logger, fn)
export const currentLogger = (): Logger => current.getStore() ?? rootLogger

// Fields and an error are both optional and may come in either order
function write(
  at: 'debug' | 'info' | 'warn' | 'error',
  message: string,
  a?: unknown,
  b?: unknown
): void {
  const fields: Fields = {}
  for (const extra of [a, b]) {
    if (extra instanceof Error) fields.err = extra
    else if (extra && typeof extra === 'object') Object.assign(fields, extra)
    else if (extra !== undefined) fields.detail = extra
  }
  currentLogger()[at](fields, message)
}

export const log = {
  debug: (message: string, a?: unknown, b?: unknown): void => write('debug', message, a, b),
  info: (message: string, a?: unknown, b?: unknown): void => write('info', message, a, b),
  warn: (message: string, a?: unknown, b?: unknown): void => write('warn', message, a, b),
  error: (message: string, a?: unknown, b?: unknown): void => write('error', message, a, b)
}

// Deletes this API's log files older than the retention period (run at startup and daily)
export function removeOldLogs(now = Date.now()): number {
  const dir = config.log.dir
  if (!dir) return 0
  const cutoff = now - config.log.retentionDays * 24 * 60 * 60 * 1000
  let removed = 0
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return 0
  }
  for (const name of names) {
    if (!name.startsWith('api-') || !name.endsWith('.log')) continue
    const path = join(dir, name)
    try {
      if (statSync(path).mtimeMs < cutoff) {
        unlinkSync(path)
        removed++
      }
    } catch {
      // Another instance removed it first
    }
  }
  return removed
}

// Writes what's buffered (on shutdown)
export const flushLogs = (): Promise<void> =>
  new Promise((resolve) => rootLogger.flush(() => resolve()))
