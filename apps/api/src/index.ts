// Masarat API: one Hono app (app.ts) serving masarat.com, owner.masarat.com and govt.masarat.com.
// ROUTES.md lists the endpoints still to wire up.
import { app } from './app'
import { config } from './config'
import { log } from './log'
import { clearStaging, removeOrphanFolders } from './services/documents'
import { clearStaleExports } from './services/exports'
import { ensureDemoData } from './services/demoData'
import { assertPricingAllowed } from './services/pricing'
import { purgeExpired } from './services/sessions'

const HOUR_MS = 60 * 60 * 1000

// Production must not price trips with the development formula
try {
  assertPricingAllowed()
} catch (err) {
  log.error((err as Error).message)
  process.exit(1)
}

// Uploads staged for trips that were never saved, and folders of deleted trips, don't outlive a
// restart. The demo companies are seeded only in demo mode.
clearStaging()
// Exports half-built when the API stopped
clearStaleExports(0)
await removeOrphanFolders()
await purgeExpired()
setInterval(
  () => purgeExpired().catch((err) => log.error('Purging sessions failed:', err)),
  HOUR_MS
)
if (config.demoMode) {
  await ensureDemoData()
  log.info('Demo mode: demo accounts and data are seeded')
}

export default {
  port: config.port,
  // A request that sends nothing for this long is closed; Postgres's own limit (shorter) has
  // stopped its query by then. Exports lift it for themselves (routes/govt.ts).
  idleTimeout: config.requestTimeoutS,
  fetch: app.fetch
}
