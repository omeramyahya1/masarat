// The government's raw data export: trips, bills, cargo items and tax lines for the chosen filters,
// as one Excel workbook (a sheet per dataset) or CSV files (one per dataset). Headers and labels are
// in Arabic, passed in by the renderer.
import ExcelJS from 'exceljs'
import { and, asc, eq, gte, inArray, lt, sql, type SQL, type SQLWrapper } from 'drizzle-orm'
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
  vehicles
} from '../db'
import { formatDay, resolveRange } from '@masarat/shared/analytics'
import { toSudanDateTime } from '@masarat/shared/settings'
import {
  EXPORT_COLUMNS,
  exportColumns,
  type ExportDataset,
  type ExportInput,
  type ExportRows
} from '@masarat/shared/exports'
import type { FleetResult } from '@masarat/shared/fleet'
import { inFilteredTrips } from './analyticsQuery'

type Cell = string | number | Date | null
type Row = Cell[]

// Columns holding a date with a time, or a date alone
const DATE_TIME_COLUMNS = new Set(['createdAt', 'paidAt', 'issuedAt', 'departureAt', 'arrivalAt'])
const DATE_COLUMNS = new Set<string>()

const origin = alias(cities, 'export_origin')
const destination = alias(cities, 'export_destination')

// The trips the export covers: the filters, the period on the chosen date, and the status
async function selectTripIds(input: ExportInput): Promise<number[]> {
  const { from, to } = resolveRange(input.filters.range, new Date())
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
  const rows = await getDb()
    .select({ id: manifests.id })
    .from(manifests)
    .leftJoin(payments, eq(payments.manifestId, manifests.id))
    .where(and(period, status, inFilteredTrips(manifests.id, input.filters)))
    .orderBy(asc(manifests.departureAt), asc(manifests.id))
  return rows.map((r) => r.id)
}

const stateNameAr = (stateId: SQLWrapper): SQL<string> =>
  sql<string>`(select ${states.nameAr} from ${states} where ${states.id} = ${stateId})`

// Builds each dataset's rows, in EXPORT_COLUMNS order
async function buildRows(input: ExportInput, ids: number[]): Promise<Record<ExportDataset, Row[]>> {
  const db = getDb()
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
    .innerJoin(companies, eq(vehicles.companyId, companies.id))
    .innerJoin(origin, eq(manifests.originCityId, origin.id))
    .innerJoin(destination, eq(manifests.destinationCityId, destination.id))
    .leftJoin(payments, eq(payments.manifestId, manifests.id))
    .leftJoin(certificates, eq(certificates.manifestId, manifests.id))
    .where(inArray(manifests.id, ids))
    .orderBy(asc(manifests.departureAt), asc(manifests.id))
  const byId = new Map(trips.map((trip) => [trip.id, trip]))

  const items = await db
    .select()
    .from(manifestCargoItems)
    .where(inArray(manifestCargoItems.manifestId, ids))
    .orderBy(asc(manifestCargoItems.manifestId), asc(manifestCargoItems.position))
  const cargoTypes = new Map<number, Set<string>>()
  for (const item of items) {
    cargoTypes.set(
      item.manifestId,
      (cargoTypes.get(item.manifestId) ?? new Set()).add(item.cargoType)
    )
  }
  const trailers = new Map<number, string[]>()
  for (const trailer of await db
    .select()
    .from(manifestTrailers)
    .where(inArray(manifestTrailers.manifestId, ids))
    .orderBy(asc(manifestTrailers.position))) {
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
  for (const p of await db
    .select()
    .from(tripPassengers)
    .where(inArray(tripPassengers.manifestId, ids))
    .orderBy(asc(tripPassengers.manifestId), asc(tripPassengers.position))) {
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
  for (const line of await db
    .select()
    .from(manifestCharges)
    .where(inArray(manifestCharges.manifestId, ids))
    .orderBy(asc(manifestCharges.manifestId), asc(manifestCharges.position))) {
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

function toCsv(input: ExportInput, dataset: ExportDataset, data: Row[]): string {
  const { columns, rows } = shaped(input, dataset, data)
  const header = columns.map((c) => csvField(input.labels.columns[dataset]?.[c] ?? c, c))
  const lines = [
    header.join(','),
    ...rows.map((row) => row.map((v, i) => csvField(v, columns[i])).join(','))
  ]
  // The byte order mark makes Excel read the file as UTF-8 (Arabic text)
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

async function writeWorkbook(
  input: ExportInput,
  data: Record<ExportDataset, Row[]>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Masarat'
  workbook.created = new Date()
  for (const dataset of input.datasets) {
    const { columns, rows } = shaped(input, dataset, data[dataset])
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
    // Excel has no time zones: a date cell holds the wall-clock time it shows. exceljs writes a
    // Date's UTC time, so dates are shifted to Sudan's wall-clock time first (the CSV writes the
    // server's local time, which is Sudan's too).
    sheet.addRows(
      rows.map((row) => row.map((cell) => (cell instanceof Date ? asSudanWallClock(cell) : cell)))
    )
    const header = sheet.getRow(1)
    header.font = { bold: true }
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7F0EA' } }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

// A Date whose UTC time is the Sudan wall-clock time of this instant
const asSudanWallClock = (date: Date): Date =>
  new Date(`${toSudanDateTime(date.getTime())}:${String(date.getSeconds()).padStart(2, '0')}Z`)

// One file of an export, for the API to send back (several files go into a zip)
export interface ExportFile {
  name: string
  content: Buffer | string
}

// Builds the export: an Excel workbook and/or one CSV per dataset
export async function exportData(
  input: ExportInput
): Promise<FleetResult<{ files: ExportFile[]; archiveName: string; rows: ExportRows }>> {
  const data = await buildRows(input, await selectTripIds(input))
  const rows = Object.fromEntries(input.datasets.map((d) => [d, data[d].length]))
  const { from, to } = resolveRange(input.filters.range, new Date())
  const span = `${formatDay(from)}-${formatDay(new Date(to.getTime() - 1))}`

  const files: ExportFile[] = []
  if (input.formats.includes('xlsx')) {
    files.push({ name: `masarat-data-${span}.xlsx`, content: await writeWorkbook(input, data) })
  }
  if (input.formats.includes('csv')) {
    for (const dataset of input.datasets) {
      files.push({
        name: `masarat-${dataset}-${span}.csv`,
        content: toCsv(input, dataset, data[dataset])
      })
    }
  }
  // Several files go to the browser as one ZIP of this name
  return { ok: true, data: { files, archiveName: `masarat-export-${span}.zip`, rows } }
}
