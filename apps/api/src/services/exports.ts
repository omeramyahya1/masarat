// The government's raw data export: trips, bills, cargo items, passengers and tax lines for the
// chosen filters, as one Excel workbook (a sheet per dataset) or CSV files (one per dataset).
// Headers and labels are in Arabic, passed in by the portal.
//
// A month at national volume is hundreds of thousands of trips and millions of passengers, so
// nothing is held in memory: the trips are read in batches (by keyset, a few thousand ids per
// query), each batch's rows are written to files in a temporary folder as they come, and the
// route streams the finished file (or a ZIP of several) from disk. An Excel sheet holds at most
// 1,048,576 rows; an export that would pass that is refused up front, with the counts, so the
// user picks CSV or a shorter period.
import {
  closeSync,
  createWriteStream,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  statSync,
  writeSync
} from 'fs'
import { finished } from 'stream/promises'
import { join } from 'path'
import { randomBytes } from 'crypto'
import ExcelJS from 'exceljs'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import {
  and,
  asc,
  count,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  lt,
  or,
  sql,
  type SQL,
  type SQLWrapper
} from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import {
  certificates,
  cities,
  companies,
  getDb,
  manifestCargoItems,
  manifestCharges,
  manifestTrailers,
  manifests,
  tripPassengers,
  payments,
  states,
  vehicles,
  type AppDatabase
} from '../db'
import { config } from '../config'
import { formatDay, resolveRange } from '@masarat/shared/analytics'
import { toSudanDateTime } from '@masarat/shared/settings'
import {
  EXCEL_MAX_ROWS,
  EXPORT_COLUMNS,
  exportColumns,
  type ExportDataset,
  type ExportInput,
  type ExportRows
} from '@masarat/shared/exports'
import { inFilteredTrips } from './analyticsQuery'

type Cell = string | number | Date | null
type Row = Cell[]

// Columns holding a date with a time, or a date alone
const DATE_TIME_COLUMNS = new Set(['createdAt', 'paidAt', 'issuedAt', 'departureAt', 'arrivalAt'])
const DATE_COLUMNS = new Set<string>()

const origin = alias(cities, 'export_origin')
const destination = alias(cities, 'export_destination')

// Batch size and Excel's limit; tests make them small
export const exportLimits = {
  // Trip ids per batch: each dataset query takes them as parameters (Postgres allows 65,534)
  batch: 5_000,
  excelRows: EXCEL_MAX_ROWS,
  // What a classic ZIP holds (4 GiB less one byte), with room for its headers
  zipBytes: 0xffffffff - 64 * 1024 * 1024
}

// The export's period, resolved once: a preset runs up to now, so resolving it again during a long
// export would move its end (or its start, past midnight) between the counts and the batches
type Range = { from: Date; to: Date }

// The trips the export covers: the filters, the period on the chosen date, and the status
function tripSelection(input: ExportInput, { from, to }: Range): SQL | undefined {
  const period: SQL | undefined =
    input.dateBasis === 'trip'
      ? and(gte(manifests.departureAt, from), lt(manifests.departureAt, to))
      : input.dateBasis === 'billed'
        ? and(gte(payments.createdAt, from), lt(payments.createdAt, to))
        : and(eq(payments.status, 'paid'), gte(payments.paidAt, from), lt(payments.paidAt, to))
  const status: SQL | undefined =
    input.status === 'all'
      ? undefined
      : input.status === 'billed'
        ? inArray(manifests.status, ['billed', 'paid'])
        : eq(manifests.status, input.status)
  return and(period, status, inFilteredTrips(manifests.id, input.filters))
}

// The covered trips' ids, in departure order, one batch after another (keyset paging: each
// batch starts after the last one's departure and id)
async function* tripIdBatches(
  db: AppDatabase,
  input: ExportInput,
  range: Range
): AsyncGenerator<number[]> {
  const where = tripSelection(input, range)
  let after: { departureAt: Date; id: number } | null = null
  for (;;) {
    const rows: { id: number; departureAt: Date }[] = await db
      .select({ id: manifests.id, departureAt: manifests.departureAt })
      .from(manifests)
      .leftJoin(payments, eq(payments.manifestId, manifests.id))
      .where(
        and(
          where,
          after
            ? or(
                gt(manifests.departureAt, after.departureAt),
                and(eq(manifests.departureAt, after.departureAt), gt(manifests.id, after.id))
              )
            : undefined
        )
      )
      .orderBy(asc(manifests.departureAt), asc(manifests.id))
      .limit(exportLimits.batch)
    if (rows.length === 0) return
    yield rows.map((r) => r.id)
    if (rows.length < exportLimits.batch) return
    after = rows[rows.length - 1]
  }
}

// How many rows each requested dataset will have, counted by Postgres before anything is written
async function countRows(db: AppDatabase, input: ExportInput, range: Range): Promise<ExportRows> {
  const trips = db
    .select({ id: manifests.id })
    .from(manifests)
    .leftJoin(payments, eq(payments.manifestId, manifests.id))
    .where(tripSelection(input, range))
  const countIn = async (
    table: typeof manifestCargoItems | typeof tripPassengers | typeof manifestCharges
  ): Promise<number> => {
    const [row] = await db
      .select({ value: count() })
      .from(table)
      .where(inArray(table.manifestId, trips))
    return row?.value ?? 0
  }
  const rows: ExportRows = {}
  for (const dataset of input.datasets) {
    if (dataset === 'trips' || dataset === 'bills') {
      const [row] = await db
        .select({ value: count() })
        .from(manifests)
        .leftJoin(payments, eq(payments.manifestId, manifests.id))
        .where(
          and(
            tripSelection(input, range),
            dataset === 'bills' ? isNotNull(payments.billId) : undefined
          )
        )
      rows[dataset] = row?.value ?? 0
    } else if (dataset === 'items') rows.items = await countIn(manifestCargoItems)
    else if (dataset === 'passengers') rows.passengers = await countIn(tripPassengers)
    else rows.taxLines = await countIn(manifestCharges)
  }
  return rows
}

const stateNameAr = (stateId: SQLWrapper): SQL<string> =>
  sql<string>`(select ${states.nameAr} from ${states} where ${states.id} = ${stateId})`

// Builds each dataset's rows, in EXPORT_COLUMNS order
async function buildRows(
  db: AppDatabase,
  input: ExportInput,
  ids: number[],
  wanted: ReadonlySet<ExportDataset>
): Promise<Record<ExportDataset, Row[]>> {
  const value = (group: string, key: string | null | undefined): string | null =>
    key ? (input.labels.values[group]?.[key] ?? key) : null
  const empty: Record<ExportDataset, Row[]> = {
    trips: [],
    bills: [],
    items: [],
    passengers: [],
    taxLines: []
  }
  if (ids.length === 0) return empty

  const trips = await db
    .select({
      id: manifests.id,
      manifestNo: certificates.manifestNo,
      departureAt: manifests.departureAt,
      arrivalAt: manifests.arrivalAt,
      createdAt: manifests.createdAt,
      status: manifests.status,
      category: manifests.category,
      ticketPrice: manifests.ticketPrice,
      cargoType: manifests.cargoType,
      companyName: companies.name,
      plate: vehicles.plateNumber,
      registrationNo: vehicles.registrationNo,
      vehicleType: vehicles.vehicleType,
      tripKind: manifests.tripKind,
      origin: origin.name,
      originAr: origin.nameAr,
      // Exports are in Arabic
      originState: stateNameAr(origin.stateId),
      destination: destination.name,
      destinationAr: destination.nameAr,
      destinationState: stateNameAr(destination.stateId),
      distanceKm: manifests.distanceKm,
      driverName: manifests.driverName,
      driverPhone: manifests.driverPhone,
      shipperName: manifests.shipperName,
      receiverName: manifests.receiverName,
      cargoQuantity: manifests.cargoQuantity,
      cargoUnit: manifests.cargoUnit,
      tripCost: manifests.tripCost,
      amountDue: manifests.taxAmount,
      billId: payments.billId,
      billAmount: payments.amount,
      billStatus: payments.status,
      issuedAt: payments.createdAt,
      paidAt: payments.paidAt,
      paymentRef: payments.paymentRef
    })
    .from(manifests)
    .innerJoin(vehicles, eq(manifests.vehicleId, vehicles.id))
    .innerJoin(companies, eq(manifests.companyId, companies.id))
    .innerJoin(origin, eq(manifests.originCityId, origin.id))
    .innerJoin(destination, eq(manifests.destinationCityId, destination.id))
    .leftJoin(payments, eq(payments.manifestId, manifests.id))
    .leftJoin(certificates, eq(certificates.manifestId, manifests.id))
    .where(inArray(manifests.id, ids))
    .orderBy(asc(manifests.departureAt), asc(manifests.id))
  const byId = new Map(trips.map((trip) => [trip.id, trip]))
  // A trip's items, passengers and tax lines follow the trips' order (by departure), each trip's
  // in their own order, so the files are the same however the trips were batched
  const tripOrder = new Map(trips.map((trip, i) => [trip.id, i]))
  const inTripOrder = <T extends { manifestId: number; position: number }>(list: T[]): T[] =>
    list.sort(
      (a, b) =>
        (tripOrder.get(a.manifestId) ?? 0) - (tripOrder.get(b.manifestId) ?? 0) ||
        a.position - b.position
    )

  const items =
    wanted.has('trips') || wanted.has('items')
      ? await db
          .select()
          .from(manifestCargoItems)
          .where(inArray(manifestCargoItems.manifestId, ids))
          .then(inTripOrder)
      : []
  const cargoTypes = new Map<number, Set<string>>()
  for (const item of items) {
    cargoTypes.set(
      item.manifestId,
      (cargoTypes.get(item.manifestId) ?? new Set()).add(item.cargoType)
    )
  }
  const trailers = new Map<number, string[]>()
  for (const trailer of wanted.has('trips')
    ? await db
        .select()
        .from(manifestTrailers)
        .where(inArray(manifestTrailers.manifestId, ids))
        .orderBy(asc(manifestTrailers.position))
    : []) {
    trailers.set(trailer.manifestId, [
      ...(trailers.get(trailer.manifestId) ?? []),
      trailer.plateNumber
    ])
  }

  const rows = empty
  for (const t of trips) {
    rows.trips.push([
      t.id,
      t.manifestNo,
      t.departureAt,
      t.arrivalAt,
      t.createdAt,
      value('statuses', t.status),
      value('categories', t.category),
      t.companyName,
      t.plate,
      t.registrationNo,
      value('vehicleTypes', t.vehicleType),
      (trailers.get(t.id) ?? []).join('، ') || null,
      value('tripKinds', t.tripKind),
      t.originAr ?? t.origin,
      t.originState,
      t.destinationAr ?? t.destination,
      t.destinationState,
      t.distanceKm,
      t.driverName,
      t.driverPhone,
      t.shipperName,
      t.receiverName,
      // Trips from before cargo items existed have only their own type; passenger trips none
      [...(cargoTypes.get(t.id) ?? new Set(t.cargoType ? [t.cargoType] : []))]
        .map((c) => value('cargoTypes', c))
        .join('، ') || null,
      t.cargoQuantity,
      value('units', t.cargoUnit),
      t.ticketPrice,
      t.tripCost,
      t.amountDue,
      t.billId,
      t.paidAt
    ])
    if (t.billId) {
      rows.bills.push([
        t.billId,
        t.id,
        t.manifestNo,
        t.companyName,
        t.plate,
        t.billAmount,
        value('paymentStatuses', t.billStatus),
        t.issuedAt,
        t.paidAt,
        t.paymentRef
      ])
    }
  }
  for (const item of items) {
    rows.items.push([
      item.manifestId,
      byId.get(item.manifestId)?.manifestNo ?? null,
      item.position + 1,
      item.name,
      value('cargoTypes', item.cargoType),
      item.packingType,
      item.packageCount,
      item.quantity,
      value('units', item.unit),
      item.cost,
      item.notes
    ])
  }
  for (const p of wanted.has('passengers')
    ? await db
        .select()
        .from(tripPassengers)
        .where(inArray(tripPassengers.manifestId, ids))
        .then(inTripOrder)
    : []) {
    const trip = byId.get(p.manifestId)
    rows.passengers.push([
      p.manifestId,
      trip?.manifestNo ?? null,
      trip?.departureAt ?? null,
      p.seatNo,
      p.fullName,
      value('yesNo', String(p.isInfant)),
      value('idTypes', p.idType),
      p.idNumber,
      p.notes
    ])
  }
  for (const line of wanted.has('taxLines')
    ? await db
        .select()
        .from(manifestCharges)
        .where(inArray(manifestCharges.manifestId, ids))
        .then(inTripOrder)
    : []) {
    const trip = byId.get(line.manifestId)
    rows.taxLines.push([
      line.manifestId,
      trip?.manifestNo ?? null,
      trip?.billId ?? null,
      // The name the bill was issued with
      line.nameAr,
      line.rateBps === null ? null : line.rateBps / 100,
      line.amount,
      trip?.paidAt ?? null
    ])
  }
  return rows
}

const pad = (n: number): string => String(n).padStart(2, '0')
const dateTimeText = (date: Date): string =>
  `${formatDay(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`

// RFC 4180: quote fields with commas, quotes or line breaks
// Text a spreadsheet would run as a formula when it opens the CSV ("=…", "+…", "-…", "@…"): such
// cells get a leading apostrophe, so they stay text (names, notes and phones come from users).
// Numbers and dates are written as they are. Excel files don't need this: their text cells are
// typed as text.
const FORMULA_START = /^[=+\-@\t\r]/

function csvField(value: Cell, column: string): string {
  if (value === null) return ''
  const text =
    value instanceof Date
      ? DATE_COLUMNS.has(column)
        ? formatDay(value)
        : dateTimeText(value)
      : typeof value === 'string' && FORMULA_START.test(value)
        ? `'${value}`
        : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

// A dataset's columns and rows as this export writes them (without the ID columns unless asked)
function shaped(
  input: ExportInput,
  dataset: ExportDataset,
  rows: Row[]
): { columns: readonly string[]; rows: Row[] } {
  const all: readonly string[] = EXPORT_COLUMNS[dataset]
  const columns = exportColumns(dataset, input.includeIdNumbers)
  if (columns.length === all.length) return { columns, rows }
  const keep = columns.map((c) => all.indexOf(c))
  return { columns, rows: rows.map((row) => keep.map((i) => row[i])) }
}

// The header line of a dataset's CSV, with the byte order mark that makes Excel read UTF-8 (Arabic)
function csvHeader(input: ExportInput, dataset: ExportDataset): string {
  const columns = exportColumns(dataset, input.includeIdNumbers)
  return `\uFEFF${columns.map((c) => csvField(input.labels.columns[dataset]?.[c] ?? c, c)).join(',')}\r\n`
}

function csvLines(input: ExportInput, dataset: ExportDataset, data: Row[]): string {
  const { columns, rows } = shaped(input, dataset, data)
  return rows.map((row) => row.map((v, i) => csvField(v, columns[i])).join(',') + '\r\n').join('')
}

// A sheet of the streamed workbook, its header styled and frozen
function addSheet(
  workbook: ExcelJS.stream.xlsx.WorkbookWriter,
  input: ExportInput,
  dataset: ExportDataset
): ExcelJS.Worksheet {
  const columns = exportColumns(dataset, input.includeIdNumbers)
  // Sheet names are limited to 31 characters and some punctuation
  const name = (input.labels.sheets[dataset] ?? dataset).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)
  const sheet = workbook.addWorksheet(name, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }]
  })
  sheet.columns = columns.map((column) => ({
    header: input.labels.columns[dataset]?.[column] ?? column,
    key: column,
    width: DATE_TIME_COLUMNS.has(column) ? 18 : DATE_COLUMNS.has(column) ? 12 : 16,
    style: DATE_TIME_COLUMNS.has(column)
      ? { numFmt: 'yyyy-mm-dd hh:mm' }
      : DATE_COLUMNS.has(column)
        ? { numFmt: 'yyyy-mm-dd' }
        : undefined
  }))
  const header = sheet.getRow(1)
  header.font = { bold: true }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F0EA' } }
  return sheet
}

// A Date whose UTC time is the Sudan wall-clock time of this instant. Excel has no time zones: a
// date cell holds the wall-clock time it shows, and exceljs writes a Date's UTC time (the CSV
// writes the server's local time, which is Sudan's too).
const asSudanWallClock = (date: Date): Date =>
  new Date(`${toSudanDateTime(date.getTime())}:${String(date.getSeconds()).padStart(2, '0')}Z`)

// Exports in progress live in <STORAGE_DIR>/exports/<random>; a folder older than this is left
// over from an export that failed or a download that was dropped, and is removed
const EXPORTS_DIR = (): string => join(config.storageDir, 'exports')
const STALE_MS = 60 * 60 * 1000

export function clearStaleExports(maxAgeMs = STALE_MS): void {
  let folders: string[]
  try {
    folders = readdirSync(EXPORTS_DIR())
  } catch {
    return
  }
  for (const folder of folders) {
    const path = join(EXPORTS_DIR(), folder)
    try {
      if (Date.now() - statSync(path).mtimeMs >= maxAgeMs)
        rmSync(path, { recursive: true, force: true })
    } catch {
      // Gone already, or in use: the next sweep gets it
    }
  }
}

// One file of an export
export interface ExportFile {
  name: string
  path: string
}

export type ExportResult =
  | {
      ok: true
      data: {
        // What the browser gets: the one file, or the ZIP of several
        download: ExportFile
        files: ExportFile[]
        rows: ExportRows
        // Removes the export's folder; call once the download has been sent
        cleanup: () => void
      }
    }
  // Over Excel's limit: the counts say which dataset
  | { ok: false; error: 'export_too_large_for_excel'; rows: ExportRows }
  // Too big to send as one ZIP: a shorter period, or fewer datasets or formats
  | { ok: false; error: 'export_too_large'; rows: ExportRows }

// Builds the export's files: an Excel workbook and/or one CSV per dataset, and a ZIP of them when
// there are several. Every query gets the export's own statement timeout.
export async function exportData(input: ExportInput): Promise<ExportResult> {
  clearStaleExports()
  const range = resolveRange(input.filters.range, new Date())
  const { from, to } = range
  const span = `${formatDay(from)}-${formatDay(new Date(to.getTime() - 1))}`
  const folder = join(EXPORTS_DIR(), randomBytes(12).toString('hex'))
  const cleanup = (): void => rmSync(folder, { recursive: true, force: true })

  return getDb().transaction(async (tx) => {
    await tx.execute(
      sql`SET LOCAL statement_timeout = ${sql.raw(String(Math.round(config.exportStatementTimeoutMs)))}`
    )
    const rows = await countRows(tx, input, range)
    if (
      input.formats.includes('xlsx') &&
      input.datasets.some((d) => (rows[d] ?? 0) > exportLimits.excelRows)
    ) {
      return { ok: false as const, error: 'export_too_large_for_excel' as const, rows }
    }

    mkdirSync(folder, { recursive: true })
    try {
      const files: ExportFile[] = []
      const wantedAll = new Set(input.datasets)

      // CSV: every dataset in one pass over the trips, each to its own file
      if (input.formats.includes('csv')) {
        // Each file's descriptor is kept as soon as it's opened, so a failure further on (another
        // open, a write) still closes every one
        const csv: { dataset: ExportDataset; file: ExportFile; fd: number }[] = []
        try {
          for (const dataset of input.datasets) {
            const file = {
              name: `masarat-${dataset}-${span}.csv`,
              path: join(folder, `${dataset}.csv`)
            }
            csv.push({ dataset, file, fd: openSync(file.path, 'w') })
            writeAll(csv[csv.length - 1].fd, csvHeader(input, dataset))
          }
          for await (const ids of tripIdBatches(tx, input, range)) {
            const data = await buildRows(tx, input, ids, wantedAll)
            for (const out of csv) writeAll(out.fd, csvLines(input, out.dataset, data[out.dataset]))
          }
        } finally {
          for (const out of csv) closeSync(out.fd)
        }
        files.push(...csv.map((out) => out.file))
      }

      // Excel: one sheet after the other (a streamed workbook writes its sheets in order), each a
      // pass over the trips
      if (input.formats.includes('xlsx')) {
        const file = { name: `masarat-data-${span}.xlsx`, path: join(folder, 'data.xlsx') }
        // The workbook writes into a stream this export owns, so a failure can close it
        const out = createWriteStream(file.path)
        const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
          stream: out,
          useStyles: true,
          useSharedStrings: false
        })
        workbook.creator = 'Masarat'
        workbook.created = new Date()
        try {
          for (const dataset of input.datasets) {
            const sheet = addSheet(workbook, input, dataset)
            for await (const ids of tripIdBatches(tx, input, range)) {
              const data = await buildRows(tx, input, ids, new Set([dataset]))
              for (const row of shaped(input, dataset, data[dataset]).rows) {
                sheet
                  .addRow(row.map((cell) => (cell instanceof Date ? asSudanWallClock(cell) : cell)))
                  .commit()
              }
            }
            sheet.commit()
          }
          await workbook.commit()
          // The file is complete once the stream has flushed and closed
          await finished(out)
        } catch (err) {
          out.destroy()
          throw err
        }
        files.unshift(file)
      }

      if (files.length === 1)
        return { ok: true as const, data: { download: files[0], files, rows, cleanup } }
      // Several files go to the browser as one ZIP, written to disk as it's built. The ZIP writer
      // makes classic ZIPs, which can't hold 4 GiB or more: refuse an export that might pass that
      // (the files' own sizes bound the compressed ones, plus a margin for headers)
      const bytes = files.reduce((sum, f) => sum + statSync(f.path).size, 0)
      if (bytes > exportLimits.zipBytes) {
        cleanup()
        return { ok: false as const, error: 'export_too_large' as const, rows }
      }
      const zip = { name: `masarat-export-${span}.zip`, path: join(folder, 'export.zip') }
      await writeZip(zip.path, files)
      return { ok: true as const, data: { download: zip, files, rows, cleanup } }
    } catch (err) {
      cleanup()
      throw err
    }
  })
}

// Writes all of `data` to the file, however many calls it takes (writeSync may write fewer bytes
// than asked), and fails if a write makes no progress
function writeAll(fd: number, data: string | Uint8Array): void {
  const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
  let offset = 0
  while (offset < bytes.length) {
    const written = writeSync(fd, bytes, offset, bytes.length - offset)
    if (written <= 0) throw new Error('Writing the export file made no progress')
    offset += written
  }
}

// A ZIP of the files, streamed into `path` (CSV compressed; a workbook is compressed already)
async function writeZip(path: string, files: ExportFile[]): Promise<void> {
  const fd = openSync(path, 'w')
  try {
    let failure: Error | null = null
    const zip = new Zip((err, chunk) => {
      if (err) failure = err
      else writeAll(fd, chunk)
    })
    for (const file of files) {
      const entry = file.name.endsWith('.xlsx')
        ? new ZipPassThrough(file.name)
        : new ZipDeflate(file.name, { level: 6 })
      zip.add(entry)
      for await (const chunk of Bun.file(file.path).stream()) entry.push(chunk)
      entry.push(new Uint8Array(0), true)
    }
    zip.end()
    if (failure) throw failure
  } finally {
    closeSync(fd)
  }
}
