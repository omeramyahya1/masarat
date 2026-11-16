import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core'

export const vehicles = sqliteTable('vehicles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  plateNumber: text('plate_number').notNull().unique(),
  vehicleType: text('vehicle_type').notNull().default('truck'),
  capacity: real('capacity').default(0),
  status: text('status').default('active')
})

export type Vehicle = typeof vehicles.$inferSelect
export type NewVehicle = typeof vehicles.$inferInsert
