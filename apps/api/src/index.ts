// Masarat API: one Hono app (app.ts) serving masarat.com, owner.masarat.com and govt.masarat.com.
// ROUTES.md lists the endpoints still to wire up.
import { app } from './app'
import { config } from './config'
import { log } from './log'
import { clearStaging, removeOrphanFolders } from './services/documents'
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
  fetch: app.fetch
}
