// The API's routes and middleware. index.ts runs the startup tasks and serves it; the tests call
// it directly with app.request().
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { openAPIRouteHandler } from 'hono-openapi'
import { config } from './config'
import { log } from './log'
import { fail, type AppEnv } from './http/context'
import { isQueryTimeout } from './db/errors'
import { originCheck, session } from './http/middleware'
import { REQUEST_ID_HEADER, requestLog } from './http/requestLog'
import { readiness } from './services/health'
import { MAX_DOCUMENT_BYTES } from '@masarat/shared/fleet'
import { authRoutes } from './routes/auth'
import { branchRoutes, companyMemberRoutes, companyRoutes, roleRoutes } from './routes/company'
import { documentRoutes } from './routes/documents'
import { driverRoutes, vehicleRoutes } from './routes/fleet'
import { govtRoutes } from './routes/govt'
import { govtUserRoutes } from './routes/govtUsers'
import { govtReportRoutes } from './routes/reports'
import { templateRoutes } from './routes/templates'
import { tripRoutes } from './routes/trips'
import { verifyRoutes } from './routes/verify'

// Request bodies: JSON stays small; an attachment upload may carry one file of up to 20 MB
const JSON_LIMIT = bodyLimit({ maxSize: 64 * 1024, onError: (c) => fail(c, 'too_large') })
const UPLOAD_LIMIT = bodyLimit({
  maxSize: MAX_DOCUMENT_BYTES + 64 * 1024,
  onError: (c) => fail(c, 'document_too_large')
})

export const app = new Hono<AppEnv>()
  .use(requestLog)
  // An API answers JSON and files, never pages to frame or run: the strictest browser rules
  .use(
    secureHeaders({
      strictTransportSecurity: config.cookieSecure ? 'max-age=31536000; includeSubDomains' : false,
      contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      xFrameOptions: 'DENY',
      referrerPolicy: 'no-referrer',
      crossOriginResourcePolicy: 'same-site',
      crossOriginOpenerPolicy: 'same-origin'
    })
  )
  .use(
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowHeaders: ['Content-Type'],
      // Read by the client: a download's file name, an export's row counts, the request id
      exposeHeaders: ['Content-Disposition', 'X-Export-Rows', REQUEST_ID_HEADER],
      maxAge: 600
    })
  )
  .use(originCheck)
  .use((c, next) =>
    (c.req.method === 'POST' && c.req.path === '/documents' ? UPLOAD_LIMIT : JSON_LIMIT)(c, next)
  )
  .use(session)
  // Liveness (the process answers) and readiness (it reaches Postgres, Redis and the storage)
  .get('/health', (c) => c.json({ ok: true }))
  .get('/health/ready', async (c) => {
    const result = await readiness()
    return c.json({ ok: result.ready, data: result }, result.ready ? 200 : 503)
  })
  // What the web apps need to know before signing in
  .get('/config', (c) => c.json({ ok: true, data: { demoMode: config.demoMode } }))
  .route('/auth', authRoutes)
  .route('/company', companyRoutes)
  .route('/branches', branchRoutes)
  .route('/roles', roleRoutes)
  .route('/members', companyMemberRoutes)
  .route('/govt/users', govtUserRoutes)
  .route('/govt/reports', govtReportRoutes)
  .route('/govt', govtRoutes)
  .route('/vehicles', vehicleRoutes)
  .route('/drivers', driverRoutes)
  .route('/trips', tripRoutes)
  .route('/templates', templateRoutes)
  .route('/documents', documentRoutes)
  .route('/verify', verifyRoutes)

// The API's description (OpenAPI 3.1), built from the routes' schemas; development only
if (!config.production) {
  app.get(
    '/openapi.json',
    openAPIRouteHandler(app, {
      documentation: {
        info: {
          title: 'Masarat API',
          version: '1',
          description:
            'Every endpoint answers JSON `{ ok: true, data }` or `{ ok: false, error }`. A body or ' +
            'query that does not match its schema answers 400 `invalid_request` (some routes keep ' +
            'their own code). Requests that change something must come from one of the three web ' +
            'apps (Origin) with the session cookie.'
        }
      }
    })
  )
}

app.notFound((c) => fail(c, 'not_found'))
app.onError((err, c) => {
  log.error('Unhandled error', err, { method: c.req.method, path: c.req.path })
  // A query that ran past the statement timeout: the client can say "took too long, narrow it".
  // The request id lets whoever reports the error point at its log lines.
  const error = isQueryTimeout(err) ? 'query_timeout' : 'unknown'
  return c.json(
    { ok: false, error, requestId: c.get('requestId') },
    error === 'unknown' ? 500 : 503
  )
})
