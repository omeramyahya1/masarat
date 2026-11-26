// Development and tests only: lets the API's least-privileged role (migration 0010) log in with
// the password in DATABASE_URL. In production the DBA sets its password; this never runs there.
import { sql } from 'drizzle-orm'
import { config } from '../config'
import type { AppDatabase } from './client'

export async function enableDevAppRole(owner: AppDatabase): Promise<void> {
  if (config.production) throw new Error('The app role password is set by the DBA in production')
  const url = new URL(config.databaseUrl)
  const role = decodeURIComponent(url.username)
  if (role !== 'masarat_app') return
  const password = decodeURIComponent(url.password)
  // ALTER ROLE takes no bind parameters: the password is quoted as a literal
  const literal = `'${password.replaceAll("'", "''")}'`
  await owner.execute(sql.raw(`ALTER ROLE masarat_app LOGIN PASSWORD ${literal}`))
}
