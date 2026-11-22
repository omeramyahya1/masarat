// Text matching for searches: case-insensitive, with the user's text taken literally
import { sql, type SQL, type SQLWrapper } from 'drizzle-orm'

export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => `\\${c}`)

export const contains = (column: SQLWrapper, text: string): SQL =>
  sql`${column} ILIKE ${`%${escapeLike(text)}%`} ESCAPE '\\'`

// The plate without spaces or the slash, uppercased: compared with plateSearchKey(query)
export const plateKeyOf = (column: SQLWrapper): SQL =>
  sql`replace(replace(upper(${column}), ' ', ''), '/', '')`
