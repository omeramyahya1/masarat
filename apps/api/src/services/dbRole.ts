// The API connects to Postgres as the least-privileged role, masarat_app (migration 0010): it
// reads and writes rows but can't create, alter or drop anything, so a bug or an injected query
// can't change the schema. Migrations and seeding connect as the owner (MIGRATION_DATABASE_URL).
// At startup the API checks what it actually connected as.
import { sql } from 'drizzle-orm'
import { getDb } from '../db'

export interface RoleCheck {
  role: string
  // Superuser, may create objects in the schema, or owns tables: more than the API needs
  problems: string[]
}

export async function checkDbRole(): Promise<RoleCheck> {
  const [row] = await getDb().execute<{
    role: string
    superuser: boolean
    can_create: boolean
    owns_tables: boolean
  }>(sql`
    select current_user as role,
           (select rolsuper from pg_roles where rolname = current_user) as superuser,
           has_schema_privilege(current_user, 'public', 'CREATE') as can_create,
           exists (select 1 from pg_tables where schemaname in ('public', 'archive')
                     and tableowner = current_user) as owns_tables`)
  const problems: string[] = []
  if (row.superuser) problems.push('is a superuser')
  if (row.can_create) problems.push('may create objects in the public schema')
  if (row.owns_tables) problems.push('owns tables')
  return { role: row.role, problems }
}
