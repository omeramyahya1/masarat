// Bun closes a request that sends nothing for REQUEST_TIMEOUT_S (index.ts). Long, deliberate work
// (an export, regenerating the demo data) lifts that for its own request. Under Bun, Hono passes
// the server as the context's env; in tests (app.request) there is none, and nothing happens.
import type { AppContext } from './context'

interface BunServerLike {
  timeout?: (request: Request, seconds: number) => void
}

export function liftRequestTimeout(c: AppContext): void {
  const server = c.env as BunServerLike | undefined
  server?.timeout?.(c.req.raw, 0)
}
