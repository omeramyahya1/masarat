// The API's routes and middleware. index.ts runs the startup tasks and serves it; the tests call
// it directly with app.request().
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { config } from './config'
import { log } from './log'
import { fail, type AppEnv } from './http/context'
import { originCheck, session } from './http/middleware'
import { MAX_DOCUMENT_BYTES } from '@masarat/shared/fleet'
import { authRoutes } from './routes/auth'
import { branchRoutes, companyMemberRoutes, companyRoutes, roleRoutes } from './routes/company'
import { documentRoutes } from './routes/documents'
import { driverRoutes, vehicleRoutes } from './routes/fleet'
import { govtRoutes } from './routes/govt'
import { govtUserRoutes } from './routes/govtUsers'
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
  .use(
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowHeaders: ['Content-Type'],
      // Read by the client: a download's file name, and an export's row counts
      exposeHeaders: ['Content-Disposition', 'X-Export-Rows'],
      maxAge: 600
    })
  )
  .use(originCheck)
  .use((c, next) =>
    (c.req.method === 'POST' && c.req.path === '/documents' ? UPLOAD_LIMIT : JSON_LIMIT)(c, next)
  )
  .use(session)
  .get('/health', (c) => c.json({ ok: true }))
  // What the web apps need to know before signing in
  .get('/config', (c) => c.json({ ok: true, data: { demoMode: config.demoMode } }))
  .route('/auth', authRoutes)
  .route('/company', companyRoutes)
  .route('/branches', branchRoutes)
  .route('/roles', roleRoutes)
  .route('/members', companyMemberRoutes)
  .route('/govt/users', govtUserRoutes)
  .route('/govt', govtRoutes)
  .route('/vehicles', vehicleRoutes)
  .route('/drivers', driverRoutes)
  .route('/trips', tripRoutes)
  .route('/templates', templateRoutes)
  .route('/documents', documentRoutes)
  .route('/verify', verifyRoutes)

app.notFound((c) => fail(c, 'not_found'))
app.onError((err, c) => {
  log.error(`${c.req.method} ${c.req.path} failed:`, err)
  return fail(c, 'unknown')
})
