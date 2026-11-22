// Masarat API: one Hono app serving both portals (owner.masarat.com and govt.masarat.com).
// Only the health check exists so far; ROUTES.md lists the endpoints still to wire up.
import { Hono } from 'hono'
import { config } from './config'
import { log } from './log'
import { clearStaging, removeOrphanFolders } from './services/documents'
import { ensureDemoData } from './services/demoData'

// Uploads staged for trips that were never saved, and folders of deleted trips, don't outlive a
// restart. The demo companies are seeded only in demo mode.
clearStaging()
await removeOrphanFolders()
if (config.demoMode) {
  await ensureDemoData()
  log.info('Demo mode: demo accounts and data are seeded')
}

const app = new Hono()

app.get('/health', (c) => c.json({ ok: true }))

export default {
  port: config.port,
  fetch: app.fetch
}
