// Load-test data: fills a database with national-scale history (companies, branches, members,
// vehicles, drivers, and every trip's items, passengers, tax lines, bill, payment and certificate)
// so the load test runs against tables the size production will reach. See loadtest/README.md.
//
//   DATABASE_URL=postgres://…/masarat_load bun run --filter @masarat/api load:seed \
//     --trips-per-day 20000 --days 30 --bus-share 0.1 --out ../../loadtest/data
//
// Only for a database whose name contains "load" (it is never the dev or production one). The
// rows are generated in Postgres with set-based SQL, one day of trips per statement, several days
// at a time. The data is plausible, not exact: costs follow the pricing rates and the bills the
// current taxes and fees, but items share their trip's cost evenly.
import { mkdirSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import postgres from 'postgres'
import { parseArgs } from 'util'
import { BUILTIN_ROLES } from '@masarat/shared/permissions'
import { PLATE_CODES } from '@masarat/shared/plate'
import { config } from '../config'
import { closeDb, openUnlimitedDb } from '../db'
import { hashPassword } from '../services/auth'
import { ensureDemoData } from '../services/demoData'
import { objectStore } from '../services/storage'
import { markSummaryStale, rebuildDailyRevenue } from '../services/dailyRevenue'
import { aggregateDashboard, resetDashboardFacts } from '../services/dashboardFacts'

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'trips-per-day': { type: 'string', default: '20000' },
    days: { type: 'string', default: '30' },
    'bus-share': { type: 'string', default: '0.1' },
    // How many different people the passengers are; empty = about 2.5 trips each in a month
    people: { type: 'string' },
    'clerks-per-branch': { type: 'string', default: '4' },
    'govt-users': { type: 'string', default: '100' },
    // Only write the k6 data files, from data already seeded
    'data-only': { type: 'boolean', default: false },
    workers: { type: 'string', default: '6' },
    out: { type: 'string', default: '../../loadtest/data' }
  }
})

const TRIPS_PER_DAY = Number(args['trips-per-day'])
const DAYS = Number(args.days)
const CLERKS_PER_BRANCH = Number(args['clerks-per-branch'])
const GOVT_USERS = Number(args['govt-users'])
const DATA_ONLY = args['data-only'] === true
const WORKERS = Number(args.workers)
const OUT_DIR = resolve(args.out!)
// Everyone the load test signs in as has this password
export const LOAD_PASSWORD = 'load2026'

// The shape of the fleet: about 65 trips a day per company, 3 branches each, a bus does one trip
// a day and a truck one every day and a half; --bus-share of trips (10%) carry passengers
const BUS_SHARE = Number(args['bus-share'])
const COMPANIES = Math.max(4, Math.round(TRIPS_PER_DAY / 65))
const BRANCHES_PER_COMPANY = 3
const TRUCKS_PER_COMPANY = Math.max(
  3,
  Math.ceil((TRIPS_PER_DAY * (1 - BUS_SHARE) * 1.5) / COMPANIES)
)
const BUSES_PER_COMPANY = Math.max(1, Math.ceil((TRIPS_PER_DAY * BUS_SHARE) / COMPANIES))
const DRIVERS_PER_COMPANY = TRUCKS_PER_COMPANY + BUSES_PER_COMPANY
// Passengers travel again: each one is drawn from a pool of people, the frequent travellers more
// often (random()² leans to the low numbers). By default the pool makes each person take about
// 2.5 trips in a month (a bus carries ~43).
const PEOPLE = Math.max(
  1000,
  Math.round(Number(args.people ?? (TRIPS_PER_DAY * BUS_SHARE * 43 * 30) / 2.5))
)
// Every seeded attachment row points at this object (uploaded once, below)
const SAMPLE_DOCUMENT = 'documents/load/sample.pdf'

// The demo uses the first 6 plate codes; these never collide with it
const LOAD_PLATE_CODES = PLATE_CODES.slice(6)

// Seeding creates working tables, so it connects as the owner (MIGRATION_DATABASE_URL)
const dbName = new URL(config.migrationDatabaseUrl).pathname.slice(1)
if (!dbName.includes('load')) {
  console.error(`Refusing to seed "${dbName}": the load-test database's name must contain "load".`)
  process.exit(1)
}
for (const [name, value] of Object.entries({
  TRIPS_PER_DAY,
  DAYS,
  CLERKS_PER_BRANCH,
  GOVT_USERS,
  WORKERS
})) {
  if (!Number.isInteger(value) || value <= 0) {
    console.error(`${name} must be a positive whole number`)
    process.exit(1)
  }
}

const sql = postgres(config.migrationDatabaseUrl, {
  max: WORKERS + 1,
  onnotice: () => {},
  connection: { TimeZone: config.timeZone }
})
const started = Date.now()
const elapsed = (): string => `${((Date.now() - started) / 1000).toFixed(0)}s`
const step = (message: string): void => console.log(`[${elapsed()}] ${message}`)

// The files the k6 scripts read: who to sign in as, and real values to look up
async function writeDataFiles(): Promise<void> {
  // What the k6 scripts need: who to sign in as, and real values to look up
  mkdirSync(OUT_DIR, { recursive: true })
  const usernames = async (pattern: string): Promise<string[]> =>
    (
      await sql<
        { username: string }[]
      >`SELECT username FROM users WHERE username LIKE ${pattern} ORDER BY id`
    ).map((u) => u.username)
  const write = (name: string, data: unknown): void =>
    writeFileSync(resolve(OUT_DIR, name), JSON.stringify(data))
  write('users.json', {
    password: LOAD_PASSWORD,
    clerks: await usernames('lt.c%.clerk%'),
    accountants: await usernames('lt.c%.acct'),
    admins: await usernames('lt.c%.admin'),
    govt: await usernames('lt.govt%')
  })
  const column = async (query: string): Promise<string[]> =>
    (await sql.unsafe<{ v: string }[]>(query)).map((r) => r.v)
  // Spread over the whole history: every 37th row, shuffled (a full scan, but only once)
  const sample = (select: string, from: string, where = 'true', limit = 1000): Promise<string[]> =>
    column(
      `SELECT ${select} AS v FROM ${from} WHERE ${where} AND id % 37 = 0 ORDER BY random() LIMIT ${limit}`
    )
  write('verify.json', {
    valid: await column(
      `SELECT qr_token AS v FROM certificates WHERE valid_until > now() ORDER BY random() LIMIT 5000`
    ),
    expired: await sample('qr_token', 'certificates', 'valid_until <= now()')
  })
  // Lookups, from the whole history, and split by age: government agents mostly look up this
  // week's trips (k6 govtReview)
  const lookups = async (since: string, until: string): Promise<Record<string, string[]>> => ({
    billIds: await column(
      `SELECT bill_id AS v FROM payments WHERE created_at >= ${since} AND created_at < ${until} ORDER BY random() LIMIT 1000`
    ),
    manifestNos: await column(
      `SELECT manifest_no AS v FROM certificates WHERE issued_at >= ${since} AND issued_at < ${until} ORDER BY random() LIMIT 1000`
    ),
    tripIds: await column(
      `SELECT id::text AS v FROM manifests WHERE departure_at >= ${since} AND departure_at < ${until} ORDER BY random() LIMIT 1000`
    )
  })
  write('search.json', {
    billIds: await sample('bill_id', 'payments'),
    manifestNos: await sample('manifest_no', 'certificates'),
    plates: await column(`SELECT plate_number AS v FROM vehicles ORDER BY random() LIMIT 1000`),
    idNumbers: await sample('id_number', 'people'),
    tripIds: await sample('id::text', 'manifests'),
    recent: await lookups(`now() - interval '7 days'`, `now()`),
    older: await lookups(`'-infinity'`, `now() - interval '7 days'`)
  })
}

// --data-only: the files for the k6 scripts again, from the data already seeded
if (DATA_ONLY) {
  await writeDataFiles()
  step('Data files written')
  await sql.end()
  process.exit(0)
}

const [{ count: existing }] = await sql<{ count: number }[]>`
  SELECT count(*)::int AS count FROM companies WHERE name LIKE 'LT %'`
if (existing > 0) {
  console.error('This database already has load-test data. Drop it and migrate again to reseed.')
  process.exit(1)
}

// The demo companies first, as the API would seed them in demo mode (its plates and phones never
// collide with the ones below)
// The bulk inserts below skip the payment flow: the summary is stale until it's rebuilt at the end
await markSummaryStale()
step('Seeding the demo data')
await ensureDemoData()
await objectStore.put(
  SAMPLE_DOCUMENT,
  new TextEncoder().encode('%PDF-1.4\n% Masarat load-test sample attachment\n%%EOF\n'),
  'application/pdf'
)
await closeDb()

step(
  `${COMPANIES} companies × (${BRANCHES_PER_COMPANY} branches, ${TRUCKS_PER_COMPANY} trucks, ` +
    `${BUSES_PER_COMPANY} buses, ${DRIVERS_PER_COMPANY} drivers); ${TRIPS_PER_DAY} trips a day for ${DAYS} days, ` +
    `${Math.round(BUS_SHARE * 100)}% by bus, passengers from ${PEOPLE} people`
)

const passwordHash = await hashPassword(LOAD_PASSWORD)
const permissionRows = (key: 'clerk' | 'accountant'): string =>
  BUILTIN_ROLES[key].permissions.map((p) => `('${p}')`).join(', ')

// Companies, their roles and branches, members, vehicles and drivers
await sql.begin(async (tx) => {
  await tx`
    INSERT INTO companies (name, address, tin)
    SELECT 'LT ' || lpad(i::text, 4, '0') || ' للنقل', 'الخرطوم، شارع ' || i, 'TIN' || lpad(i::text, 9, '0')
    FROM generate_series(1, ${COMPANIES}) i`
  await tx`
    INSERT INTO roles (company_id, key, name, scope)
    SELECT c.id, r.key, r.name, r.scope
    FROM companies c
    CROSS JOIN (VALUES ('company_admin', 'Company admin', 'company'),
                       ('clerk', 'Clerk', 'branch'),
                       ('accountant', 'Accountant', 'company')) r(key, name, scope)
    WHERE c.name LIKE 'LT %'`
  for (const key of ['clerk', 'accountant'] as const) {
    await tx.unsafe(`
      INSERT INTO role_permissions (role_id, permission)
      SELECT r.id, p.permission FROM roles r
      JOIN companies c ON c.id = r.company_id AND c.name LIKE 'LT %'
      CROSS JOIN (VALUES ${permissionRows(key)}) p(permission)
      WHERE r.key = '${key}'`)
  }
  // Branches in state capitals, a different set per company
  await tx`
    WITH caps AS (SELECT row_number() OVER (ORDER BY capital_city_id) - 1 AS i, capital_city_id AS city_id
                  FROM states WHERE capital_city_id IS NOT NULL),
         n AS (SELECT count(*) AS n FROM caps),
         lc AS (SELECT row_number() OVER (ORDER BY id) - 1 AS cidx, id FROM companies WHERE name LIKE 'LT %')
    INSERT INTO branches (company_id, name, city_id)
    SELECT lc.id, 'فرع ' || (k + 1), caps.city_id
    FROM lc CROSS JOIN generate_series(0, ${BRANCHES_PER_COMPANY - 1}) k CROSS JOIN n
    JOIN caps ON caps.i = (lc.cidx + k * 5) % n.n`

  // Members: an admin and an accountant per company, clerks per branch, and the government's agents
  await tx`
    WITH lc AS (SELECT row_number() OVER (ORDER BY id) AS ci, id FROM companies WHERE name LIKE 'LT %'),
         people AS (
           SELECT lc.id AS company_id, 'lt.c' || lc.ci || '.admin' AS username, 'company_admin' AS key, NULL::int AS branch_id
           FROM lc
           UNION ALL
           SELECT lc.id, 'lt.c' || lc.ci || '.acct', 'accountant', NULL FROM lc
           UNION ALL
           SELECT lc.id, 'lt.c' || lc.ci || '.b' || b.k || '.clerk' || j, 'clerk', b.id
           FROM lc
           JOIN (SELECT id, company_id, row_number() OVER (PARTITION BY company_id ORDER BY id) AS k FROM branches) b
             ON b.company_id = lc.id
           CROSS JOIN generate_series(1, ${CLERKS_PER_BRANCH}) j
         )
    INSERT INTO users (username, password_hash, kind, full_name, phone, company_id, role_id, branch_id)
    SELECT p.username, ${passwordHash}, 'company', 'مستخدم ' || p.username,
           '+24911' || lpad((row_number() OVER (ORDER BY p.username))::text, 7, '0'),
           p.company_id, r.id, p.branch_id
    FROM people p JOIN roles r ON r.company_id = p.company_id AND r.key = p.key`
  await tx`
    INSERT INTO users (username, password_hash, kind, full_name, phone, role_id)
    SELECT 'lt.govt' || i, ${passwordHash}, 'govt', 'موظف حكومي ' || i,
           '+24912' || lpad(i::text, 7, '0'),
           (SELECT id FROM roles WHERE company_id IS NULL AND key = 'govt_agent')
    FROM generate_series(1, ${GOVT_USERS}) i`

  // Vehicles: trucks (tankers count in liters) and buses, each with a unique plate
  const codes = `ARRAY[${LOAD_PLATE_CODES.map((c) => `'${c}'`).join(',')}]`
  const nCodes = LOAD_PLATE_CODES.length
  await tx.unsafe(`
    WITH lc AS (SELECT row_number() OVER (ORDER BY id) - 1 AS cidx, id FROM companies WHERE name LIKE 'LT %'),
         v AS (
           SELECT lc.id AS company_id, g, k,
                  CASE WHEN k >= ${TRUCKS_PER_COMPANY} THEN 'bus'
                       ELSE (ARRAY['heavy_duty_truck','lorry','light_duty_truck','jumbo_truck','tanker','container_truck'])[1 + (g % 6)]
                  END AS vehicle_type
           FROM lc CROSS JOIN generate_series(0, ${TRUCKS_PER_COMPANY + BUSES_PER_COMPANY - 1}) k
           CROSS JOIN LATERAL (SELECT lc.cidx * ${TRUCKS_PER_COMPANY + BUSES_PER_COMPANY} + k AS g) gg
         )
    INSERT INTO vehicles (company_id, plate_number, registration_no, vehicle_type, capacity, capacity_unit)
    SELECT company_id,
           (${codes})[1 + g % ${nCodes}] || ' ' || (1 + (g / ${nCodes}) % 99) || '/' || (1 + g / ${nCodes * 99}),
           'REG-' || lpad(g::text, 7, '0'),
           vehicle_type,
           CASE vehicle_type WHEN 'bus' THEN 45 + g % 6 WHEN 'tanker' THEN 36000 ELSE 40 END,
           CASE vehicle_type WHEN 'bus' THEN 'seat' WHEN 'tanker' THEN 'liter' ELSE 'ton' END
    FROM v`)
  await tx`
    WITH lc AS (SELECT row_number() OVER (ORDER BY id) - 1 AS cidx, id FROM companies WHERE name LIKE 'LT %')
    INSERT INTO drivers (company_id, name, phone)
    SELECT lc.id, (ARRAY['محمد','أحمد','عثمان','عبدالله','الطيب','حسن','إبراهيم','الصادق'])[1 + k % 8] || ' ' ||
                  (ARRAY['آدم','موسى','الأمين','عمر','بابكر','يوسف','علي'])[1 + (k / 8) % 7] || ' ' || k,
           '+24913' || lpad((lc.cidx * ${DRIVERS_PER_COMPANY} + k)::text, 7, '0')
    FROM lc CROSS JOIN generate_series(0, ${DRIVERS_PER_COMPANY - 1}) k`
})
step('Companies, members, vehicles and drivers done')

// Lookup tables the trip generator joins on: each company's vehicles, drivers and branches by
// position, and the routes between state capitals with their road distance
await sql.unsafe(`
  DROP TABLE IF EXISTS lt_company, lt_truck, lt_bus, lt_driver, lt_branch, lt_route;
  CREATE UNLOGGED TABLE lt_company AS
    SELECT row_number() OVER (ORDER BY id) - 1 AS cidx, id, name, address, tin
    FROM companies WHERE name LIKE 'LT %';
  CREATE UNLOGGED TABLE lt_truck AS
    SELECT company_id, row_number() OVER (PARTITION BY company_id ORDER BY id) - 1 AS idx, id, vehicle_type, capacity_unit
    FROM vehicles WHERE vehicle_type <> 'bus' AND company_id IN (SELECT id FROM lt_company);
  CREATE UNLOGGED TABLE lt_bus AS
    SELECT company_id, row_number() OVER (PARTITION BY company_id ORDER BY id) - 1 AS idx, id, capacity::int AS seats
    FROM vehicles WHERE vehicle_type = 'bus' AND company_id IN (SELECT id FROM lt_company);
  CREATE UNLOGGED TABLE lt_driver AS
    SELECT company_id, row_number() OVER (PARTITION BY company_id ORDER BY id) - 1 AS idx, id, name, phone
    FROM drivers WHERE company_id IN (SELECT id FROM lt_company);
  CREATE UNLOGGED TABLE lt_branch AS
    SELECT b.company_id, row_number() OVER (PARTITION BY b.company_id ORDER BY b.id) - 1 AS idx, b.id, b.city_id,
           (SELECT min(u.id) FROM users u WHERE u.branch_id = b.id) AS clerk_id
    FROM branches b WHERE b.company_id IN (SELECT id FROM lt_company);
  CREATE UNLOGGED TABLE lt_route AS
    SELECT row_number() OVER (ORDER BY a.id, b.id) - 1 AS ridx, a.id AS origin, b.id AS destination,
           round((2 * 6371 * asin(sqrt(power(sin(radians(b.lat - a.lat) / 2), 2)
             + cos(radians(a.lat)) * cos(radians(b.lat)) * power(sin(radians(b.lng - a.lng) / 2), 2))) * 1.3)::numeric, 1)::float AS km
    FROM cities a JOIN cities b ON a.id <> b.id
    WHERE a.id IN (SELECT capital_city_id FROM states) AND b.id IN (SELECT capital_city_id FROM states);
  CREATE INDEX ON lt_truck (company_id, idx);
  CREATE INDEX ON lt_bus (company_id, idx);
  CREATE INDEX ON lt_driver (company_id, idx);
  CREATE INDEX ON lt_branch (company_id, idx);
  ANALYZE lt_company, lt_truck, lt_bus, lt_driver, lt_branch, lt_route;
`)
const [{ routes }] = await sql<{ routes: number }[]>`SELECT count(*)::int AS routes FROM lt_route`

// Pricing and the taxes and fees as they are now, built into the SQL
const rates = await sql<{ code: string; rate_per_km: number; per_quantity: number }[]>`
  SELECT code, rate_per_km, per_quantity FROM pricing_rates`
const rate = (code: string): { rate_per_km: number; per_quantity: number } => {
  const found = rates.find((r) => r.code === code)
  if (!found) throw new Error(`No pricing rate for ${code}`)
  return found
}
const charges = await sql<
  {
    code: string
    name: string
    name_ar: string
    kind: string
    cargo_value: number | null
    passenger_value: number | null
    sort: number
  }[]
>`SELECT code, name, name_ar, kind, cargo_value, passenger_value, sort FROM charges
  WHERE active ORDER BY (kind = 'fixed'), sort, id`
const lineAmount = (
  c: (typeof charges)[number],
  column: 'cargo_value' | 'passenger_value'
): string => (c.kind === 'percent' ? `round(cost::numeric * ${c[column]} / 10000)` : `${c[column]}`)
const taxSum = (column: 'cargo_value' | 'passenger_value'): string =>
  charges
    .filter((c) => c[column] !== null)
    .map((c) => lineAmount(c, column))
    .join(' + ') || '0'
const chargeValues = charges
  .map(
    (c, i) =>
      `(${i + 1}, '${c.code}', '${c.name.replace(/'/g, "''")}', '${c.name_ar.replace(/'/g, "''")}', '${c.kind}', ${c.cargo_value ?? 'NULL'}, ${c.passenger_value ?? 'NULL'})`
  )
  .join(', ')
const cargoRateCase = `CASE cargo_type ${['fuel', 'liquids', 'containers', 'general_cargo']
  .map((code) => `WHEN '${code}' THEN ${rate(code).rate_per_km}`)
  .join(' ')} END`
const cargoPerCase = `CASE cargo_type ${['fuel', 'liquids', 'containers', 'general_cargo']
  .map((code) => `WHEN '${code}' THEN ${rate(code).per_quantity}`)
  .join(' ')} END`
const ticketRate = rate('passenger').rate_per_km

// One day of trips, with everything that hangs off them, in one statement
const daySql = (dayOffset: number): string => `
WITH g AS (
  SELECT (current_date + ${dayOffset})::timestamptz AS day,
         random() AS r_c, random() AS r_cat, random() AS r_v, random() AS r_route, random() AS r_h,
         random() AS r_ct, random() AS r_q, random() AS r_s, random() AS r_b, random() AS r_d, random() AS r_k
  FROM generate_series(1, ${TRIPS_PER_DAY})
),
t AS (
  SELECT g.*, c.id AS company_id, c.name AS carrier_name, c.address AS carrier_address, c.tin AS carrier_tin,
         (g.r_cat < ${BUS_SHARE}) AS is_bus, rt.origin, rt.destination, rt.km,
         br.id AS branch_id, br.clerk_id, dr.id AS driver_id, dr.name AS driver_name, dr.phone AS driver_phone,
         coalesce(bv.id, tv.id) AS vehicle_id, tv.vehicle_type, tv.capacity_unit, bv.seats
  FROM g
  JOIN lt_company c ON c.cidx = floor(g.r_c * ${COMPANIES})
  JOIN lt_route rt ON rt.ridx = floor(g.r_route * ${routes})
  JOIN lt_branch br ON br.company_id = c.id AND br.idx = floor(g.r_b * ${BRANCHES_PER_COMPANY})
  JOIN lt_driver dr ON dr.company_id = c.id AND dr.idx = floor(g.r_d * ${DRIVERS_PER_COMPANY})
  LEFT JOIN lt_truck tv ON g.r_cat >= ${BUS_SHARE} AND tv.company_id = c.id AND tv.idx = floor(g.r_v * ${TRUCKS_PER_COMPANY})
  LEFT JOIN lt_bus bv ON g.r_cat < ${BUS_SHARE} AND bv.company_id = c.id AND bv.idx = floor(g.r_v * ${BUSES_PER_COMPANY})
),
p AS (
  SELECT t.*,
         CASE WHEN is_bus THEN NULL
              WHEN vehicle_type = 'tanker' THEN CASE WHEN r_ct < 0.75 THEN 'fuel' ELSE 'liquids' END
              WHEN vehicle_type = 'container_truck' OR r_ct < 0.15 THEN 'containers'
              ELSE 'general_cargo' END AS cargo_type,
         CASE WHEN is_bus THEN least(seats, 35 + floor(r_q * 16))
              WHEN vehicle_type = 'tanker' THEN 20000 + floor(r_q * 16000)
              ELSE 8 + floor(r_q * 30) END AS qty,
         day + make_interval(mins => (300 + floor(r_h * 900))::int) AS departure_at
  FROM t
),
q AS (
  SELECT p.*,
         CASE WHEN is_bus THEN ${ticketRate} ELSE ${cargoRateCase} END AS rate_per_km,
         CASE WHEN is_bus THEN round(${ticketRate} * km) ELSE NULL END AS ticket_price,
         departure_at + make_interval(mins => ceil(km / CASE WHEN is_bus THEN 70 ELSE 50 END * 60)::int) AS arrival_at,
         CASE WHEN is_bus THEN round(${ticketRate} * km) * qty
              ELSE round(${cargoRateCase} * km * qty / ${cargoPerCase}) END AS cost,
         CASE WHEN departure_at > now() THEN
                CASE WHEN r_s < 0.5 THEN 'draft' WHEN r_s < 0.7 THEN 'billed' ELSE 'certified' END
              WHEN departure_at > now() - interval '2 days' THEN
                CASE WHEN r_s < 0.05 THEN 'draft' WHEN r_s < 0.15 THEN 'billed' ELSE 'certified' END
              ELSE CASE WHEN r_s < 0.02 THEN 'draft' WHEN r_s < 0.04 THEN 'billed' ELSE 'certified' END
         END AS status
  FROM p
),
m AS (
  INSERT INTO manifests (vehicle_id, company_id, branch_id, created_by, origin_city_id, destination_city_id, category,
    cargo_type, cargo_quantity, cargo_unit, departure_at, arrival_at, distance_km, rate_per_km, ticket_price,
    trip_cost, tax_amount, status, trip_kind, driver_id, driver_name, driver_phone,
    shipper_name, shipper_address, shipper_phone, receiver_name, receiver_address, receiver_phone,
    carrier_name, carrier_address, carrier_tin, created_at, updated_at)
  SELECT vehicle_id, company_id, branch_id, clerk_id, origin, destination,
         CASE WHEN is_bus THEN 'passenger' ELSE 'cargo' END,
         cargo_type, qty, CASE WHEN is_bus THEN 'seat' ELSE capacity_unit END,
         departure_at, arrival_at, km, rate_per_km, ticket_price, cost,
         CASE WHEN is_bus THEN ${taxSum('passenger_value')} ELSE ${taxSum('cargo_value')} END,
         status,
         CASE WHEN is_bus OR r_k < 0.8 THEN 'domestic' WHEN r_k < 0.9 THEN 'import' ELSE 'export' END,
         driver_id, driver_name, driver_phone,
         CASE WHEN is_bus THEN NULL ELSE 'شركة المرسل ' || floor(r_k * 500) END,
         CASE WHEN is_bus THEN NULL ELSE 'السوق المركزي' END,
         CASE WHEN is_bus THEN NULL ELSE '+2499' || lpad(floor(r_k * 1e8)::text, 8, '0') END,
         CASE WHEN is_bus THEN NULL ELSE 'شركة المستلم ' || floor(r_q * 500) END,
         CASE WHEN is_bus THEN NULL ELSE 'المنطقة الصناعية' END,
         CASE WHEN is_bus THEN NULL ELSE '+2499' || lpad(floor(r_q * 1e8)::text, 8, '0') END,
         CASE WHEN status = 'draft' THEN NULL ELSE carrier_name END,
         CASE WHEN status = 'draft' THEN NULL ELSE carrier_address END,
         CASE WHEN status = 'draft' THEN NULL ELSE carrier_tin END,
         departure_at - make_interval(mins => (60 + floor(r_h * 1440))::int),
         departure_at - make_interval(mins => 30)
  FROM q
  RETURNING id, category, cargo_type, cargo_quantity, cargo_unit, trip_cost, tax_amount, status,
            departure_at, arrival_at, rate_per_km, created_at, trip_kind
),
-- Cargo trips' attachments: the invoice, a packing list on 2 in 3, and the trade authorization on
-- imports and exports (1–3 files of about 2 MB). The rows point at one shared sample object: the
-- tables and the preview path are what's tested here; storage is sized by arithmetic
docs AS (
  INSERT INTO trip_documents (manifest_id, doc_type, file_name, stored_name, size)
  SELECT m.id, d.doc_type, d.doc_type || '.pdf', '${SAMPLE_DOCUMENT}', 2000000
  FROM m CROSS JOIN LATERAL (VALUES ('commercial_invoice'), ('packing_list'), ('trade_authorization')) d(doc_type)
  WHERE m.category = 'cargo'
    AND (d.doc_type = 'commercial_invoice'
      OR (d.doc_type = 'packing_list' AND m.id % 3 <> 0)
      OR (d.doc_type = 'trade_authorization' AND m.trip_kind IN ('import', 'export')))
),
items AS (
  INSERT INTO manifest_cargo_items (manifest_id, position, name, quantity, unit, cargo_type, rate_per_km,
    per_quantity, cost, packing_type, package_count, notes)
  SELECT m.id, k, (ARRAY['سكر','دقيق','أسمنت','زيت طعام','بضائع عامة','حديد تسليح','قطع غيار','ذرة'])[1 + (m.id + k) % 8],
         round((m.cargo_quantity / n.n)::numeric, 2)::float, m.cargo_unit, m.cargo_type, m.rate_per_km,
         ${cargoPerCase.replace(/cargo_type/g, 'm.cargo_type')}, round(m.trip_cost / n.n),
         (ARRAY['شوال','كرتون','براميل','طرود'])[1 + (m.id + k) % 4], 10 + (m.id % 90), NULL
  FROM m CROSS JOIN LATERAL (SELECT 1 + (m.id % 4) AS n) n CROSS JOIN LATERAL generate_series(1, n.n) k
  WHERE m.category = 'cargo'
),
trailers AS (
  INSERT INTO manifest_trailers (manifest_id, position, plate_number)
  SELECT m.id, 1, 'KH ' || (1 + m.id % 99) || '/' || (1 + m.id % 99999)
  FROM m WHERE m.category = 'cargo' AND m.id % 4 = 0
),
pgen AS (
  SELECT m.id AS manifest_id, s, k,
         (ARRAY['محمد','فاطمة','أحمد','آمنة','عثمان','مريم','الطيب','هالة','إبراهيم','سلمى'])[1 + k % 10] || ' ' ||
         (ARRAY['عبدالله','الحسن','آدم','موسى','الأمين','بابكر','يوسف','علي'])[1 + (k / 10) % 8] AS full_name,
         CASE WHEN k % 20 = 0 THEN 'passport' ELSE 'national_id' END AS id_type,
         CASE WHEN k % 20 = 0 THEN 'P' || lpad(k::text, 8, '0')
              ELSE (10000000000 + k)::text END AS id_number
  FROM m CROSS JOIN LATERAL generate_series(1, m.cargo_quantity::int) s
  -- The person: one of the pool, the same ID and name every time they travel
  CROSS JOIN LATERAL (SELECT floor(power(random() + 0 * s, 2) * ${PEOPLE})::bigint AS k) kk
  WHERE m.category = 'passenger'
),
-- Each passenger's person in the registry (one row per ID, the latest name)
ppl AS (
  INSERT INTO people (id_type, id_number, full_name)
  SELECT DISTINCT ON (id_type, id_number) id_type, id_number, full_name FROM pgen
  ORDER BY id_type, id_number
  ON CONFLICT (id_type, id_number) DO UPDATE SET full_name = EXCLUDED.full_name, updated_at = now()
  RETURNING id, id_type, id_number
),
pax AS (
  INSERT INTO trip_passengers (manifest_id, position, full_name, person_id, seat_no, is_infant, notes)
  SELECT g.manifest_id, g.s, g.full_name, ppl.id, g.s, false, NULL
  FROM pgen g JOIN ppl ON ppl.id_type = g.id_type AND ppl.id_number = g.id_number
),
lines AS (
  INSERT INTO manifest_charges (manifest_id, position, code, name, name_ar, rate_bps, amount)
  SELECT m.id, ch.pos, ch.code, ch.name, ch.name_ar,
         CASE WHEN ch.kind = 'percent' THEN v.value END,
         CASE WHEN ch.kind = 'percent' THEN round(m.trip_cost::numeric * v.value / 10000) ELSE v.value END
  FROM m
  CROSS JOIN (VALUES ${chargeValues}) ch(pos, code, name, name_ar, kind, cargo_value, passenger_value)
  CROSS JOIN LATERAL (SELECT CASE WHEN m.category = 'passenger' THEN ch.passenger_value ELSE ch.cargo_value END AS value) v
  WHERE v.value IS NOT NULL
),
billed AS (
  SELECT m.*, to_char(m.created_at, 'YYYYMM') || '0' || to_char(m.created_at, 'DD') || lpad(m.id::text, 13, '0') AS bill_id,
         m.created_at + interval '10 minutes' AS billed_at,
         m.created_at + make_interval(mins => (20 + m.id % 200)::int) AS paid_at
  FROM m WHERE m.status IN ('billed', 'certified') AND m.tax_amount > 0
),
pay AS (
  INSERT INTO payments (manifest_id, bill_id, amount, status, bank, payment_ref, paid_at, created_at, updated_at)
  SELECT id, bill_id, tax_amount,
         CASE WHEN status = 'certified' THEN 'paid' ELSE 'pending' END,
         CASE WHEN status = 'certified' THEN (ARRAY['Bankak','Fawry','O-Cash'])[1 + id % 3] END,
         CASE WHEN status = 'certified' THEN 'LTREF' || id END,
         CASE WHEN status = 'certified' THEN paid_at END,
         billed_at, coalesce(CASE WHEN status = 'certified' THEN paid_at END, billed_at)
  FROM billed
),
sim AS (
  INSERT INTO esali_sim_bills (bill_id, amount, status, payment_ref, paid_at, created_at, updated_at)
  SELECT bill_id, tax_amount,
         CASE WHEN status = 'certified' THEN 'paid' ELSE 'pending' END,
         CASE WHEN status = 'certified' THEN 'LTREF' || id END,
         CASE WHEN status = 'certified' THEN paid_at END, billed_at, billed_at
  FROM billed
)
INSERT INTO certificates (manifest_id, certificate_no, manifest_no, qr_token, issued_at, valid_until)
SELECT id,
       'MSR-' || to_char(paid_at, 'YYYY') || '-' || CASE WHEN id < 1000000 THEN lpad(id::text, 6, '0') ELSE id::text END,
       CASE WHEN category = 'passenger' THEN 'PSG-' ELSE 'MNF-' END || to_char(paid_at, 'YYYY') || '-' ||
         CASE WHEN id < 1000000 THEN lpad(id::text, 6, '0') ELSE id::text END,
       md5(id::text || random()::text || clock_timestamp()::text),
       paid_at, arrival_at + interval '24 hours'
FROM billed WHERE status = 'certified'
`

// Days from DAYS-1 ago to tomorrow, spread over the workers
const offsets = Array.from({ length: DAYS + 1 }, (_, i) => i - DAYS + 1)
let done = 0
const worker = async (): Promise<void> => {
  for (;;) {
    const offset = offsets.shift()
    if (offset === undefined) return
    // Days run in parallel and share the people, so two may wait on each other's rows; Postgres
    // then cancels one (a deadlock), and that day (one statement, all or nothing) runs again
    for (let attempt = 1; ; attempt++) {
      try {
        await sql.unsafe(daySql(offset))
        break
      } catch (e) {
        if ((e as { code?: string }).code !== '40P01' || attempt === 5) throw e
      }
    }
    done++
    if (done % 10 === 0 || done === DAYS + 1) step(`${done} / ${DAYS + 1} days of trips`)
  }
}
await Promise.all(Array.from({ length: WORKERS }, worker))

step('Rebuilding the daily revenue summary')
const summary = openUnlimitedDb()
await rebuildDailyRevenue(summary.db)
await summary.close()

step("Aggregating the dashboard's days")
await resetDashboardFacts()
await aggregateDashboard()
await closeDb()

step('Analyzing')
await sql.unsafe(
  `DROP TABLE lt_company, lt_truck, lt_bus, lt_driver, lt_branch, lt_route; ANALYZE;`
)

await writeDataFiles()
const [size] = await sql<
  { size: string }[]
>`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`
const counts = await sql.unsafe<{ t: string; n: string }[]>(`
  SELECT 'manifests' t, count(*)::text n FROM manifests UNION ALL
  SELECT 'cargo items', count(*)::text FROM manifest_cargo_items UNION ALL
  SELECT 'passengers', count(*)::text FROM trip_passengers UNION ALL
  SELECT 'tax lines', count(*)::text FROM manifest_charges UNION ALL
  SELECT 'certificates', count(*)::text FROM certificates`)
step(`Done: ${counts.map((c) => `${c.n} ${c.t}`).join(', ')}; database ${size.size}`)
await sql.end()
