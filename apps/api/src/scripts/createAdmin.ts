// Creates a government admin from the server's shell, for a new deployment's first account:
//   bun run user:create-admin <username> "<full name>"
// Prints a temporary password, which the admin replaces at their first login. After that, admins
// create the other government accounts from the Government portal (Users).
import { closeDb } from '../db'
import { createGovtUser } from '../services/govtUsers'

const [username, ...name] = process.argv.slice(2)
if (!username || name.length === 0) {
  console.error('Usage: bun run user:create-admin <username> "<full name>"')
  process.exit(1)
}

const result = await createGovtUser({ username, fullName: name.join(' '), isAdmin: true })
await closeDb()
if (!result.ok) {
  console.error(`Not created: ${result.error}`)
  process.exit(1)
}
console.log(`Created government admin ${result.data.user.username}`)
console.log(`Temporary password: ${result.data.temporaryPassword}`)
