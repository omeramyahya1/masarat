// Moves the finished trips older than HOT_DAYS to the archive now, instead of waiting for the
// nightly job (services/archive.ts): after a long outage, or in tests.
//   bun run --filter @masarat/api trips:archive
import { closeDb } from '../db'
import { archiveDueTrips } from '../services/archive'
import { closeRedis } from '../services/redis'

const moved = await archiveDueTrips()
await closeDb()
closeRedis()
console.log(`Moved ${moved} trip(s) to the archive`)
