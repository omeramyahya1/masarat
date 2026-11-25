// Redis: the state every API instance must share and that may be lost without harm (upload
// staging tokens, the public routes' rate-limit windows). Bun's built-in client, one connection
// per process, reconnecting on its own.
import { RedisClient } from 'bun'
import { config } from '../config'
import { addReadinessCheck } from './health'

let client: RedisClient | null = null

// Commands sent while it (re)connects wait for the connection; callers that must not wait long
// (the rate limit) bound them with withTimeout
export function getRedis(): RedisClient {
  client ??= new RedisClient(config.redisUrl, { autoReconnect: true, connectionTimeout: 2_000 })
  return client
}

// A Redis call that gives up after `ms`
export async function withTimeout<T>(call: Promise<T>, ms = 500): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      call,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms} ms`)), ms)
      })
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function closeRedis(): void {
  client?.close()
  client = null
}

addReadinessCheck('redis', async () => {
  const reply = await getRedis().send('PING', [])
  if (reply !== 'PONG') throw new Error(`unexpected PING reply ${String(reply)}`)
})
