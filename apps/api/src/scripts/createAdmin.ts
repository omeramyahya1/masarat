// Creates a government admin from the server's shell, for a new deployment's first account:
//   bun run user:create-admin <username> <phone> "<full name>"
// Prints a temporary password, which the admin replaces at their first login. After that, admins
// create the other government accounts from the Government portal (Users).
import { closeDb } from '../db'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb, roles } from '../db'
import { createMember } from '../services/members'

const [username, phone, ...name] = process.argv.slice(2)
if (!username || !phone || name.length === 0) {
  console.error('Usage: bun run user:create-admin <username> <phone> "<full name>"')
  process.exit(1)
}

const [adminRole] = await getDb()
  .select({ id: roles.id })
  .from(roles)
  .where(and(isNull(roles.companyId), eq(roles.key, 'govt_admin')))
  .limit(1)
const result = await createMember(
  { kind: 'govt' },
  { username, phone, fullName: name.join(' '), roleId: adminRole.id }
)
await closeDb()
if (!result.ok) {
  console.error(`Not created: ${result.error}`)
  process.exit(1)
}
console.log(`Created government admin ${result.data.user.username}`)
console.log(`Temporary password: ${result.data.temporaryPassword}`)
