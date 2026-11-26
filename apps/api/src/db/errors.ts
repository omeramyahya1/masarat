// Postgres errors the services turn into named results. Drizzle wraps the driver's error, so look
// through `cause` for it.
interface PgError {
  code?: string
  constraint_name?: string
}

function pgError(error: unknown): PgError | null {
  let current: unknown = error
  while (current && typeof current === 'object') {
    if ('code' in current && typeof (current as PgError).code === 'string')
      return current as PgError
    current = (current as { cause?: unknown }).cause
  }
  return null
}

// A unique index refused the row (23505), optionally a specific one
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const found = pgError(error)
  return found?.code === '23505' && (!constraint || found.constraint_name === constraint)
}

// Postgres stopped the query at the statement timeout (57014, query_canceled)
export function isQueryTimeout(error: unknown): boolean {
  return pgError(error)?.code === '57014'
}
