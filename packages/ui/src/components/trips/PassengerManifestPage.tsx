import { useRef } from 'react'
import type { TFunction } from 'i18next'
import type { TripReferenceData } from '@masarat/shared/fleet'
import type { PassengerRecord } from '@masarat/shared/passengers'
import type { CertificateRecord, TripDetails } from '@masarat/shared/billing'
import type { Formatters } from '../../lib/format'
import { documentFrame } from './documentFrame'
import { DocumentSheet, Field, Latin, Section } from './documentParts'
import { usePagedRows, type PageSlice } from './usePagedRows'

interface PassengerManifestPageProps {
  details: TripDetails
  certificate: CertificateRecord
  reference: TripReferenceData
  // Arabic translations and formatters: the document is always in Arabic
  ar: TFunction
  fa: Formatters
}

const CELL = 'border border-stone-300 px-2 py-1'

// A blank line to fill in by hand
function Blank({ className = '' }: { className?: string }): React.JSX.Element {
  return <span className={`block border-b border-stone-400 ${className}`} />
}

// The passenger manifest (كشف ركاب) of a bus trip, numbered PSG-…: the bus, the trip and the
// carrier, then the passengers with their IDs and seats across as many sheets as they need (an
// infant on the seat of the passenger they travel with), then the counts and the signatures.
// Paginated like the cargo manifest (usePagedRows).
function PassengerManifestPage({
  details,
  certificate,
  reference,
  ar,
  fa
}: PassengerManifestPageProps): React.JSX.Element {
  const { trip } = details
  const measureRef = useRef<HTMLDivElement>(null)
  const pages = usePagedRows(measureRef, details)
  const frame = documentFrame('passengers', certificate, ar, fa)
  const city = (id: number): string => fa.city(reference.cities.find((c) => c.id === id))
  const dash = (value: string | null | undefined): string => value || '—'
  // Each infant listed right after the passenger whose seat they share
  const ordered = [...trip.passengers].sort(
    (a, b) => a.seatNo - b.seatNo || Number(a.isInfant) - Number(b.isInfant)
  )
  const seated = ordered.filter((p) => !p.isInfant).length
  const infants = ordered.length - seated

  const intro = (
    <div data-measure="intro" className="flex flex-col gap-3">
      <Section title={ar('certificate.passengers.busAndTrip')} dense>
        <Field label={ar('certificate.manifest.headPlate')}>{fa.plate(trip.plateNumber)}</Field>
        <Field label={ar('certificate.manifest.registrationNo')}>
          <Latin>{dash(trip.registrationNo)}</Latin>
        </Field>
        <Field label={ar('certificate.passengers.from')}>{city(trip.originCityId)}</Field>
        <Field label={ar('certificate.passengers.to')}>{city(trip.destinationCityId)}</Field>
        <Field label={ar('certificate.fields.departureAt')}>{fa.dateTime(trip.departureAt)}</Field>
        <Field label={ar('certificate.fields.arrivalAt')}>{fa.dateTime(trip.arrivalAt)}</Field>
        <Field label={ar('certificate.manifest.carrier')}>
          <bdi>{dash(trip.carrier?.name)}</bdi>
        </Field>
        <Field label={ar('certificate.manifest.tin')}>
          <Latin>{dash(trip.carrier?.tin)}</Latin>
        </Field>
        <Field label={ar('certificate.manifest.driver')}>
          <bdi>{dash(trip.driverName)}</bdi>
        </Field>
        <Field label={ar('certificate.manifest.phone')}>
          <Latin>{dash(trip.driverPhone)}</Latin>
        </Field>
      </Section>
    </div>
  )

  const passengerTable = (
    rows: readonly { passenger: PassengerRecord; index: number }[],
    withTotal: boolean
  ): React.JSX.Element => (
    <section data-measure="cargo" className="flex flex-col gap-1.5">
      <h4 className="border-b border-brand-700 pb-1 text-[13px] font-bold text-brand-800">
        {ar('certificate.passengers.list')}
      </h4>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="bg-brand-50 text-brand-900">
            <th className={`${CELL} w-8 text-center`}>#</th>
            <th className={`${CELL} text-start`}>{ar('certificate.passengers.name')}</th>
            <th className={`${CELL} w-40 text-start`}>{ar('certificate.passengers.id')}</th>
            <th className={`${CELL} w-14 text-center`}>{ar('certificate.passengers.seat')}</th>
            <th className={`${CELL} w-36 text-start`}>{ar('certificate.cargo.notes')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ passenger: p, index }) => (
            <tr key={index} data-measure="row" className={p.isInfant ? 'text-stone-600' : ''}>
              <td className={`${CELL} text-center`}>{fa.number(index + 1)}</td>
              <td className={CELL}>
                <bdi>{p.fullName}</bdi>
              </td>
              <td className={CELL}>
                {p.idType && p.idNumber ? (
                  <span className="flex flex-col">
                    <span className="text-[10.5px] text-stone-500">
                      {ar(`idTypes.${p.idType}`)}
                    </span>
                    <Latin>{p.idNumber}</Latin>
                  </span>
                ) : (
                  '—'
                )}
              </td>
              <td className={`${CELL} text-center tabular-nums`}>{fa.number(p.seatNo)}</td>
              <td className={`${CELL} text-[11px]`}>
                <bdi>{p.notes ?? (p.isInfant ? ar('trips.passengers.infantNote') : '')}</bdi>
              </td>
            </tr>
          ))}
          {withTotal && (
            <tr data-measure="total" className="font-bold">
              <td colSpan={5} className={CELL}>
                {ar('certificate.passengers.total', {
                  seated: fa.number(seated),
                  infants: fa.number(infants)
                })}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )

  const tail = (
    <div data-measure="tail" className="flex flex-col gap-3">
      <Section title={ar('certificate.manifest.financial')} dense>
        <Field label={ar('certificate.passengers.ticketPrice')}>
          {trip.ticketPrice !== null ? fa.currency(trip.ticketPrice) : '—'}
        </Field>
        <Field label={ar('certificate.passengers.fares')}>{fa.currency(trip.tripCost)}</Field>
      </Section>
      <section className="grid grid-cols-2 gap-4 break-inside-avoid">
        {(['carrier', 'driver'] as const).map((who) => (
          <div
            key={who}
            className="flex flex-col gap-1 rounded border border-stone-300 px-2.5 py-2"
          >
            <h5 className="text-[12px] font-bold text-brand-800">
              {ar(`certificate.passengers.signatures.${who}`)}
            </h5>
            <div className="grid grid-cols-[minmax(0,1fr)_4rem] gap-2">
              <div className="flex flex-col gap-1.5">
                {(['name', 'signature', 'date'] as const).map((line) => (
                  <div key={line} className="flex items-end gap-2 text-[11px]">
                    <span className="shrink-0 text-stone-500">
                      {ar(`certificate.manifest.signatures.${line}`)}
                    </span>
                    <Blank className="flex-1" />
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-center rounded border border-dashed border-stone-300 text-[10.5px] text-stone-400">
                {ar('certificate.manifest.signatures.stamp')}
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  )

  const numbered = ordered.map((passenger, index) => ({ passenger, index }))
  const sheet = (page: PageSlice, number: number, count: number): React.JSX.Element => (
    <DocumentSheet
      key={number}
      frame={frame}
      continued={number > 1 ? ar('certificate.manifest.continued') : undefined}
      pageLabel={ar('certificate.page', { page: fa.number(number), count: fa.number(count) })}
    >
      {page.first && intro}
      {(page.end > page.start || page.last) &&
        passengerTable(numbered.slice(page.start, page.end), page.last)}
      {page.last && tail}
    </DocumentSheet>
  )

  return (
    <>
      {/* Hidden copy with every row on one sheet, measured to deal the rows out into pages */}
      <div
        ref={measureRef}
        aria-hidden
        className="no-print pointer-events-none invisible fixed top-0 -left-[10000px]"
      >
        <DocumentSheet frame={frame} pageLabel="-" measuring>
          {intro}
          {passengerTable(numbered, true)}
          {tail}
        </DocumentSheet>
      </div>
      {pages?.map((page, index) => sheet(page, index + 1, pages.length))}
    </>
  )
}

export default PassengerManifestPage
