// Every request gets an id (X-Request-Id: the proxy's when it sent a well-formed one, otherwise a
// new one), returned on the response. Everything logged while handling it carries the id, and when
// it ends one access line records what happened and how long it took.
import { createMiddleware } from 'hono/factory'
import { routePath } from 'hono/route'
import { currentLogger, rootLogger, runWithLogger } from '../log'
import { clientInfo, type AppEnv } from './context'

export const REQUEST_ID_HEADER = 'X-Request-Id'
const WELL_FORMED = /^[A-Za-z0-9._-]{8,128}$/

export const requestLog = createMiddleware<AppEnv>(async (c, next) => {
  const given = c.req.header(REQUEST_ID_HEADER)
  const requestId = given && WELL_FORMED.test(given) ? given : crypto.randomUUID()
  const logger = rootLogger.child({ requestId })
  c.set('requestId', requestId)
  c.header(REQUEST_ID_HEADER, requestId)
  const started = performance.now()

  await runWithLogger(logger, next)

  const status = c.res.status
  const user = c.get('user')
  const fields = {
    method: c.req.method,
    // The route as declared (/trips/:id), so lines group by endpoint whatever the ids
    route: routePath(c, -1),
    path: c.req.path,
    status,
    ms: Math.round((performance.now() - started) * 10) / 10,
    ip: clientInfo(c).ip,
    userId: user?.id,
    kind: user?.kind,
    companyId: user?.company?.id
  }
  // The health checks run every few seconds: kept out of the log unless they fail
  if (c.req.path.startsWith('/health') && status < 400) return
  if (status >= 500) logger.error(fields, 'request failed')
  else if (status >= 400) logger.info(fields, 'request refused')
  else logger.info(fields, 'request')
})

// The current request's id, for code that has no context at hand
export const currentRequestId = (): string | undefined =>
  currentLogger().bindings().requestId as string | undefined
