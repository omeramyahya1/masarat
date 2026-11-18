import { useId, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Download, LoaderCircle } from 'lucide-react'
import {
  tripCargoTypes,
  type FleetErrorCode,
  type TripReferenceData
} from '../../../../shared/fleet'
import type { TripDetails } from '../../../../shared/billing'
import { createFormatters } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FormAlert } from '../form/fields'
import Modal from '../ui/Modal'
import emblem from '../../assets/sudan-emblem.svg'

function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="break-inside-avoid">
      <h4 className="mb-1.5 border-b border-brand-700 pb-1 text-[13px] font-bold text-brand-800">
        {title}
      </h4>
      <dl className="grid grid-cols-2 gap-x-6 text-[12.5px]">{children}</dl>
    </section>
  )
}

function Field({
  label,
  wide,
  children
}: {
  label: string
  // Spans both columns (long values such as the bill ID)
  wide?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      className={`flex justify-between gap-3 border-0 border-b border-dotted border-stone-300 py-1.5 ${wide ? 'col-span-2' : ''}`}
    >
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-start font-semibold text-stone-900">{children}</dd>
    </div>
  )
}

interface CertificateModalProps {
  details: TripDetails
  reference: TripReferenceData
  onClose: () => void
}

// The trip certificate. It is an official document, so it is always in Arabic whatever the UI
// language; the surrounding dialog controls follow the UI language.
function CertificateModal({
  details,
  reference,
  onClose
}: CertificateModalProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const mounted = useMountedRef()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const ar = useMemo(() => i18n.getFixedT('ar'), [i18n])
  const fa = useMemo(() => createFormatters(true, ar), [ar])

  const { trip, payment, certificate, vehicleCapacity } = details
  if (!payment || !certificate) return null
  const city = (id: number): string => fa.city(reference.cities.find((c) => c.id === id))
  // Trips from before cargo items existed list their cargo type as a single line
  const cargo =
    trip.items.length > 0
      ? trip.items
      : [
          {
            name: ar(`cargoTypes.${trip.cargoType}`),
            quantity: trip.cargoQuantity,
            unit: trip.cargoUnit,
            cargoType: trip.cargoType
          }
        ]
  const latin = (value: string): React.JSX.Element => (
    <span dir="ltr" className="font-mono">
      {value}
    </span>
  )

  const savePdf = async (): Promise<void> => {
    setSaving(true)
    setSaved(false)
    setError(null)
    try {
      const result = await window.api.certificates.savePdf(certificate.certificateNo)
      if (!mounted.current) return
      if (!result.ok) setError(result.error)
      else setSaved(result.data.saved)
    } catch {
      if (mounted.current) setError('unknown')
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  // printToPDF captures the live page, so the certificate has to stay open until it's saved
  const close = (): void => {
    if (!saving) onClose()
  }

  // Rendered straight into <body> so the print styles can drop the rest of the app from layout
  return createPortal(
    <Modal labelledBy={titleId} onClose={close} className="print-dialog max-w-3xl">
      <div className="no-print mb-4 flex items-center justify-between gap-4">
        <h2 id={titleId} className="text-lg font-semibold">
          {t('certificate.dialogTitle')}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={saving}
            onClick={close}
          >
            {t('certificate.close')}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={saving}
            onClick={savePdf}
          >
            {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
            {t('certificate.download')}
          </button>
        </div>
      </div>
      {(error || saved) && (
        <div className="no-print mb-4">
          {error ? (
            <FormAlert message={t(`fleet.errors.${error}`)} />
          ) : (
            <FormAlert tone="success" message={t('certificate.saved')} />
          )}
        </div>
      )}

      <div className="flex flex-col gap-6">
        <article
          dir="rtl"
          lang="ar"
          className="print-certificate flex flex-col gap-4 rounded-lg border-2 border-double border-brand-800 bg-white p-7 text-stone-900 select-text"
        >
          <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
            <div className="flex flex-col gap-0.5 text-[13px] leading-snug font-bold">
              <span className="text-[15px]">{ar('certificate.header.republic')}</span>
              <span>{ar('certificate.header.ministry')}</span>
              <span>{ar('certificate.header.authority')}</span>
              <span className="font-semibold text-stone-600">
                {ar('certificate.header.department')}
              </span>
            </div>
            <img src={emblem} alt="" className="h-24 w-auto" />
            <div className="flex flex-col items-end gap-1 text-[12px]">
              <span className="text-stone-500">{ar('certificate.fields.certificateNo')}</span>
              {latin(certificate.certificateNo)}
              <span className="mt-1 text-stone-500">{ar('certificate.fields.issuedAt')}</span>
              <span className="font-semibold">{fa.date(certificate.issuedAt)}</span>
            </div>
          </header>

          <h3 className="border-y-2 border-brand-800 py-2 text-center text-lg font-bold text-brand-900">
            {ar('certificate.header.title')}
          </h3>

          <Section title={ar('certificate.sections.vehicle')}>
            <Field label={ar('certificate.fields.plate')}>{fa.plate(trip.plateNumber)}</Field>
            <Field label={ar('certificate.fields.vehicleType')}>
              {ar(`vehicleTypes.${trip.vehicleType}`)}
            </Field>
            <Field label={ar('certificate.fields.capacity')}>
              {fa.quantity(vehicleCapacity, trip.cargoUnit)}
            </Field>
          </Section>

          <Section title={ar('certificate.sections.trip')}>
            <Field label={ar('certificate.fields.manifestNo')}>{fa.number(trip.id)}</Field>
            <Field label={ar('certificate.fields.tripDate')}>{fa.date(trip.tripDate)}</Field>
            <Field label={ar('certificate.fields.origin')}>{city(trip.originCityId)}</Field>
            <Field label={ar('certificate.fields.destination')}>
              {city(trip.destinationCityId)}
            </Field>
            <Field label={ar('certificate.fields.cargoType')}>
              {fa.list(tripCargoTypes(trip).map((c) => ar(`cargoTypes.${c}`)))}
            </Field>
            <Field label={ar('certificate.fields.quantity')}>
              {fa.quantity(trip.cargoQuantity, trip.cargoUnit)}
            </Field>
            <Field label={ar('certificate.fields.distance')}>
              {ar('units.km', { value: fa.number(trip.distanceKm) })}
            </Field>
          </Section>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-6">
            <div className="flex flex-col gap-4">
              <Section title={ar('certificate.sections.tax')}>
                <Field label={ar('certificate.fields.tripCost')} wide>
                  {fa.currency(trip.tripCost)}
                </Field>
                {trip.taxes.map((line) => (
                  <Field key={line.code} wide label={fa.taxLine(line)}>
                    {fa.currency(line.amount)}
                  </Field>
                ))}
                <Field label={ar('certificate.fields.taxAmount')} wide>
                  {fa.currency(payment.amount)}
                </Field>
                <Field label={ar('certificate.fields.paymentStatus')}>
                  <span className="text-brand-700">{ar('certificate.paid')}</span>
                </Field>
                <Field label={ar('certificate.fields.billId')} wide>
                  {latin(payment.billId)}
                </Field>
                {payment.paidAt && (
                  <Field label={ar('certificate.fields.paidAt')}>
                    {fa.dateTime(payment.paidAt)}
                  </Field>
                )}
                {payment.paymentRef && (
                  <Field label={ar('certificate.fields.paymentRef')}>
                    {latin(payment.paymentRef)}
                  </Field>
                )}
              </Section>
              <Section title={ar('certificate.sections.certificate')}>
                <Field label={ar('certificate.fields.issuedAt')}>
                  {fa.date(certificate.issuedAt)}
                </Field>
                <Field label={ar('certificate.fields.validUntil')}>
                  {fa.date(certificate.validUntil)}
                </Field>
              </Section>
            </div>
            <figure className="flex flex-col items-center gap-1.5 pt-6">
              <img
                src={certificate.qrDataUrl}
                alt={ar('certificate.scanToVerify')}
                className="size-36 rounded border border-stone-200"
              />
              <figcaption className="text-[11px] text-stone-500">
                {ar('certificate.scanToVerify')}
              </figcaption>
            </figure>
          </div>

          <footer className="border-t border-stone-200 pt-3 text-center text-[11px] text-stone-500">
            {ar('certificate.footer')}
          </footer>
        </article>

        {/* Page 2 (and more for long lists): what the vehicle carries */}
        <article
          dir="rtl"
          lang="ar"
          className="print-certificate print-page-break flex flex-col gap-4 rounded-lg border-2 border-double border-brand-800 bg-white p-7 text-stone-900 select-text"
        >
          <header className="flex items-center justify-between gap-4 border-b-2 border-brand-800 pb-3">
            <div className="flex items-center gap-3">
              <img src={emblem} alt="" className="h-12 w-auto" />
              <div className="flex flex-col">
                <span className="text-[12px] font-bold text-stone-600">
                  {ar('certificate.header.title')}
                </span>
                <h3 className="text-lg font-bold text-brand-900">
                  {ar('certificate.cargo.title')}
                </h3>
              </div>
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-[12px]">
              <dt className="text-stone-500">{ar('certificate.fields.certificateNo')}</dt>
              <dd className="font-semibold">{latin(certificate.certificateNo)}</dd>
              <dt className="text-stone-500">{ar('certificate.fields.manifestNo')}</dt>
              <dd className="font-semibold">{fa.number(trip.id)}</dd>
              <dt className="text-stone-500">{ar('certificate.fields.plate')}</dt>
              <dd className="font-semibold">{fa.plate(trip.plateNumber)}</dd>
            </dl>
          </header>

          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-brand-50 text-brand-900">
                <th className="w-10 border border-stone-300 px-2 py-1.5 text-center">#</th>
                <th className="border border-stone-300 px-2 py-1.5 text-start">
                  {ar('certificate.cargo.item')}
                </th>
                <th className="w-32 border border-stone-300 px-2 py-1.5 text-start">
                  {ar('certificate.cargo.type')}
                </th>
                <th className="w-32 border border-stone-300 px-2 py-1.5 text-center">
                  {ar('certificate.cargo.quantity')}
                </th>
                <th className="w-28 border border-stone-300 px-2 py-1.5 text-center">
                  {ar('certificate.cargo.unit')}
                </th>
              </tr>
            </thead>
            <tbody>
              {cargo.map((item, index) => (
                <tr key={index} className="break-inside-avoid">
                  <td className="border border-stone-300 px-2 py-1.5 text-center">
                    {fa.number(index + 1)}
                  </td>
                  <td className="border border-stone-300 px-2 py-1.5">
                    <bdi>{item.name}</bdi>
                  </td>
                  <td className="border border-stone-300 px-2 py-1.5">
                    {ar(`cargoTypes.${item.cargoType}`)}
                  </td>
                  <td className="border border-stone-300 px-2 py-1.5 text-center tabular-nums">
                    {fa.number(item.quantity)}
                  </td>
                  <td className="border border-stone-300 px-2 py-1.5 text-center">
                    {ar(`units.name.${item.unit}`)}
                  </td>
                </tr>
              ))}
              {/* A body row, not <tfoot>: a footer would repeat on every printed page */}
              <tr className="break-inside-avoid font-bold">
                <td colSpan={3} className="border border-stone-300 px-2 py-1.5">
                  {ar('certificate.cargo.total')}
                </td>
                <td className="border border-stone-300 px-2 py-1.5 text-center tabular-nums">
                  {fa.number(trip.cargoQuantity)}
                </td>
                <td className="border border-stone-300 px-2 py-1.5 text-center">
                  {ar(`units.name.${trip.cargoUnit}`)}
                </td>
              </tr>
            </tbody>
          </table>

          <footer className="mt-auto border-t border-stone-200 pt-3 text-center text-[11px] text-stone-500">
            {ar('certificate.cargo.footer')}
          </footer>
        </article>
      </div>
    </Modal>,
    document.body
  )
}

export default CertificateModal
