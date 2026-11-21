// Masarat API: one Hono app serving both portals (owner.masarat.com and govt.masarat.com).
// Only the health check exists so far; ROUTES.md lists the endpoints still to wire up.
import { Hono } from 'hono'
import { config } from './config'

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

export default {
  port: config.port,
  fetch: app.fetch
}
