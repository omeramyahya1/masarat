import { useRef } from 'react'
import type { TFunction } from 'i18next'
import type { CargoItem, Party, TripReferenceData } from '../../../../shared/fleet'
import type { CertificateRecord, TripDetails } from '../../../../shared/billing'
import type { Formatters } from '../../lib/format'
import { documentFrame } from './documentFrame'
import { DocumentSheet, Field, Latin, Section } from './documentParts'
import { usePagedRows, type PageSlice } from './usePagedRows'

interface ManifestPageProps {
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

// The authorized manifest (تصريح الحركة), on as many sheets as its cargo needs: page 1 opens with
// the vehicle, trip and parties, the cargo table continues across pages, and the last page closes
// with the total, the financial and customs section and the signatures. Customs, Zakat and other
// bodies add their own stamps to the printed copy.
function ManifestPage({
  details,
  certificate,
  reference,
  ar,
  fa
}: ManifestPageProps): React.JSX.Element {
  const { trip } = details
  const measureRef = useRef<HTMLDivElement>(null)
  const pages = usePagedRows(measureRef, details)
  const frame = documentFrame('manifest', certificate, ar, fa)
  const city = (id: number): string => fa.city(reference.cities.find((c) => c.id === id))
  const dash = (value: string | null | undefined): string => value || '—'
  // Trips from before cargo items existed list their cargo type as a single line
  const cargo: CargoItem[] =
    trip.items.length > 0
      ? trip.items
      : [
          {
            name: ar(`cargoTypes.${trip.cargoType}`),
            quantity: trip.cargoQuantity,
            unit: trip.cargoUnit,
            cargoType: trip.cargoType,
            packingType: null,
            packageCount: null,
            notes: null
          }
        ]
  const partyRow = (
    party: Party
  ): { name: string; address: string; phone: string; tin: string } => ({
    name: dash(party.name),
    address: dash(party.address),
    phone: dash(party.phone),
    tin: '—'
  })
  const packages = cargo.reduce((sum, item) => sum + (item.packageCount ?? 0), 0)

  // The parties, one column each: carrier, driver, sender, receiver
  const parties: { title: string; name: string; address: string; phone: string; tin: string }[] = [
    {
      title: ar('certificate.manifest.carrier'),
      name: dash(trip.carrier?.name),
      address: dash(trip.carrier?.address),
      phone: '—',
      tin: dash(trip.carrier?.tin)
    },
    {
      title: ar('certificate.manifest.driver'),
      name: dash(trip.driverName),
      address: '—',
      phone: dash(trip.driverPhone),
      tin: '—'
    },
    { title: ar('certificate.manifest.shipper'), ...partyRow(trip.shipper) },
    { title: ar('certificate.manifest.receiver'), ...partyRow(trip.receiver) }
  ]

  const intro = (
    <div data-measure="intro" className="flex flex-col gap-3">
      <Section title={ar('certificate.manifest.vehicleAndTrip')} dense>
        <Field label={ar('certificate.manifest.headPlate')}>{fa.plate(trip.plateNumber)}</Field>
        <Field label={ar('certificate.manifest.registrationNo')}>
          <Latin>{dash(trip.registrationNo)}</Latin>
        </Field>
        <Field label={ar('certificate.fields.vehicleType')}>
          {ar(`vehicleTypes.${trip.vehicleType}`)}
        </Field>
        <Field label={ar('certificate.manifest.trailers')}>
          {trip.trailers.length > 0
            ? trip.trailers.map((plate) => fa.plate(plate)).join('، ')
            : ar('certificate.manifest.noTrailers')}
        </Field>
        <Field label={ar('certificate.manifest.loadingPoint')}>{city(trip.originCityId)}</Field>
        <Field label={ar('certificate.manifest.unloadingPoint')}>
          {city(trip.destinationCityId)}
        </Field>
        <Field label={ar('certificate.fields.tripDate')}>{fa.date(trip.tripDate)}</Field>
        <Field label={ar('certificate.manifest.tripKind')}>
          {ar(`tripKinds.${trip.tripKind}`)}
        </Field>
      </Section>

      <section className="flex flex-col gap-1 break-inside-avoid">
        <h4 className="border-b border-brand-700 pb-1 text-[13px] font-bold text-brand-800">
          {ar('certificate.manifest.parties')}
        </h4>
        <table className="w-full table-fixed border-collapse text-[11.5px]">
          <thead>
            <tr className="bg-brand-50 text-brand-900">
              <th className={`${CELL} w-24`} />
              {parties.map((p) => (
                <th key={p.title} className={`${CELL} text-start`}>
                  {p.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(['name', 'address', 'phone', 'tin'] as const).map((row) => (
              <tr key={row}>
                <th className={`${CELL} text-start font-normal text-stone-500`}>
                  {ar(`certificate.manifest.${row}`)}
                </th>
                {parties.map((p) => (
                  <td key={p.title} className={`${CELL} font-semibold`}>
                    {row === 'phone' || row === 'tin' ? (
                      <Latin>{p[row]}</Latin>
                    ) : (
                      <bdi>{p[row]}</bdi>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )

  const cargoTable = (
    rows: readonly { item: CargoItem; index: number }[],
    withTotal: boolean
  ): React.JSX.Element => (
    <section data-measure="cargo" className="flex flex-col gap-1.5">
      <h4 className="border-b border-brand-700 pb-1 text-[13px] font-bold text-brand-800">
        {ar('certificate.cargo.title')}
      </h4>
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="bg-brand-50 text-brand-900">
            <th className={`${CELL} w-8 text-center`}>#</th>
            <th className={`${CELL} text-start`}>{ar('certificate.cargo.item')}</th>
            <th className={`${CELL} w-24 text-start`}>{ar('certificate.cargo.packing')}</th>
            <th className={`${CELL} w-16 text-center`}>{ar('certificate.cargo.packages')}</th>
            <th className={`${CELL} w-28 text-center`}>{ar('certificate.cargo.weight')}</th>
            <th className={`${CELL} w-36 text-start`}>{ar('certificate.cargo.notes')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, index }) => (
            <tr key={index} data-measure="row">
              <td className={`${CELL} text-center`}>{fa.number(index + 1)}</td>
              <td className={CELL}>
                <bdi>{item.name}</bdi>
              </td>
              <td className={CELL}>
                <bdi>{dash(item.packingType)}</bdi>
              </td>
              <td className={`${CELL} text-center tabular-nums`}>
                {item.packageCount !== null ? fa.number(item.packageCount) : '—'}
              </td>
              <td className={`${CELL} text-center tabular-nums`}>
                {fa.quantity(item.quantity, item.unit)}
              </td>
              <td className={`${CELL} text-[11px]`}>
                <bdi>{item.notes ?? ''}</bdi>
              </td>
            </tr>
          ))}
          {withTotal && (
            <tr data-measure="total" className="font-bold">
              <td colSpan={3} className={CELL}>
                {ar('certificate.cargo.total')}
              </td>
              <td className={`${CELL} text-center tabular-nums`}>
                {packages > 0 ? fa.number(packages) : '—'}
              </td>
              <td className={`${CELL} text-center tabular-nums`}>
                {fa.quantity(trip.cargoQuantity, trip.cargoUnit)}
              </td>
              <td className={CELL} />
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )

  const tail = (
    <div data-measure="tail" className="flex flex-col gap-3">
      <Section title={ar('certificate.manifest.financial')} dense>
        <Field label={ar('certificate.manifest.shippingCost')}>{fa.currency(trip.tripCost)}</Field>
        <Field label={ar('certificate.manifest.customsDeclarationNo')}>
          <Blank className="mt-3 w-40" />
        </Field>
      </Section>
      <section className="grid grid-cols-3 gap-4 break-inside-avoid">
        {(['carrier', 'driver', 'receiver'] as const).map((who) => (
          <div key={who} className="flex flex-col gap-1.5 rounded border border-stone-300 p-2.5">
            <h5 className="text-[12px] font-bold text-brand-800">
              {ar(`certificate.manifest.signatures.${who}`)}
            </h5>
            <div className="grid grid-cols-[minmax(0,1fr)_4rem] gap-2">
              <div className="flex flex-col gap-2">
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

  const numbered = cargo.map((item, index) => ({ item, index }))
  const sheet = (page: PageSlice, number: number, count: number): React.JSX.Element => (
    <DocumentSheet
      key={number}
      frame={frame}
      continued={number > 1 ? ar('certificate.manifest.continued') : undefined}
      pageLabel={ar('certificate.page', { page: fa.number(number), count: fa.number(count) })}
    >
      {page.first && intro}
      {(page.end > page.start || page.last) &&
        cargoTable(numbered.slice(page.start, page.end), page.last)}
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
          {cargoTable(numbered, true)}
          {tail}
        </DocumentSheet>
      </div>
      {pages?.map((page, index) => sheet(page, index + 1, pages.length))}
    </>
  )
}

export default ManifestPage
