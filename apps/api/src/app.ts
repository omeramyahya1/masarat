// The API's routes and middleware. index.ts runs the startup tasks and serves it; the tests call
// it directly with app.request().
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { config } from './config'
import { log } from './log'
import { fail, type AppEnv } from './http/context'
import { originCheck, session } from './http/middleware'
import { authRoutes } from './routes/auth'
import { govtUserRoutes } from './routes/govtUsers'

export const app = new Hono<AppEnv>()
  .use(
    cors({
      origin: (origin) => (config.allowedOrigins.includes(origin) ? origin : null),
      credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowHeaders: ['Content-Type'],
      maxAge: 600
    })
  )
  .use(originCheck)
  // JSON requests only so far; file uploads get their own limit when their routes exist
  .use(bodyLimit({ maxSize: 64 * 1024, onError: (c) => fail(c, 'too_large') }))
  .use(session)
  .get('/health', (c) => c.json({ ok: true }))
  // What the web apps need to know before signing in
  .get('/config', (c) => c.json({ ok: true, data: { demoMode: config.demoMode } }))
  .route('/auth', authRoutes)
  .route('/govt/users', govtUserRoutes)

app.notFound((c) => fail(c, 'not_found'))
app.onError((err, c) => {
  log.error(`${c.req.method} ${c.req.path} failed:`, err)
  return fail(c, 'unknown')
})
