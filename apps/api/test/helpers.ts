import { sql } from 'drizzle-orm'
import { getDb, users } from '../src/db'

// Empties every table except the reference data the migrations seeded
export async function resetData(): Promise<void> {
  await getDb().execute(sql`
    truncate esali_sim_bills, certificates, payments, manifest_taxes, trip_documents,
      manifest_trailers, manifest_cargo_items, manifests, vehicles, drivers, tax_setting_changes,
      users restart identity cascade
  `)
  await getDb().execute(sql`
    update tax_settings set rate_bps = case code
      when 'vat' then 1700 when 'business_profit' then 300 when 'locality' then 200 end
    where amount is null
  `)
  await getDb().execute(sql`update tax_settings set amount = 1500 where code = 'manifest_fee'`)
}

export async function createUser(
  values: Partial<typeof users.$inferInsert> & { username: string; role: 'owner' | 'govt' }
): Promise<number> {
  const [user] = await getDb()
    .insert(users)
    .values({ fullName: values.username, passwordHash: 'x', ...values })
    .returning({ id: users.id })
  return user.id
}
