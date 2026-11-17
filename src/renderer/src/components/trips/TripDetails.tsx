import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleCheckBig,
  Copy,
  FileBadge,
  LoaderCircle,
  Pencil,
  ReceiptText,
  RefreshCw,
  Trash2
} from 'lucide-react'
import type { FleetErrorCode, TripRecord, TripReferenceData } from '../../../../shared/fleet'
import type { TripDetails as TripDetailsData } from '../../../../shared/billing'
import { useFormat } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FormAlert } from '../form/fields'
import PlateBadge from '../fleet/PlateBadge'
import Menu from '../ui/Menu'
import CertificateModal from './CertificateModal'
import DeleteTripDialog from './DeleteTripDialog'
import { STATUS_STYLES } from './statusStyles'
import TaxBreakdown from './TaxBreakdown'

type Action = 'generate' | 'refresh' | 'pay'

// Bill IDs are long; groups of four are easier to read aloud and compare
const groupDigits = (value: string): string => value.replace(/(\d{4})(?=\d)/g, '$1 ')

function Row({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-end font-medium text-stone-900">{children}</dd>
    </div>
  )
}

interface TripDetailsProps {
  tripId: number
  reference: TripReferenceData
  onBack: () => void
  // Opens the form on this trip (drafts only)
  onEdit: (trip: TripRecord) => void
  // The draft was deleted
  onDeleted: () => void
  // The trip's status changed, so the list needs reloading
  onChanged: () => void
}

function TripDetails({
  tripId,
  reference,
  onBack,
  onEdit,
  onDeleted,
  onChanged
}: TripDetailsProps): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const [details, setDetails] = useState<TripDetailsData | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [notPaid, setNotPaid] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showCertificate, setShowCertificate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    window.api.billing
      .getTrip(tripId)
      .then((result) => {
        if (!mounted.current) return
        if (result.ok) setDetails(result.data)
        else setError(result.error)
      })
      .catch(() => mounted.current && setError('unknown'))
  }, [tripId, mounted])

  const run = async (action: Action): Promise<void> => {
    setPending(action)
    setError(null)
    setNotPaid(false)
    try {
      if (action === 'pay') {
        const result = await window.api.billing.simulatePayment(tripId)
        if (mounted.current && !result.ok) setError(result.error)
        return
      }
      const result =
        action === 'generate'
          ? await window.api.billing.generate(tripId)
          : await window.api.billing.refresh(tripId)
      // The list must hear about a status change even if the user has already left this page
      if (result.ok && result.data.trip.status !== details?.trip.status) onChanged()
      if (!mounted.current) return
      if (!result.ok) return setError(result.error)
      setDetails(result.data)
      if (action === 'refresh' && result.data.payment?.status !== 'paid') setNotPaid(true)
    } catch {
      if (mounted.current) setError('unknown')
    } finally {
      if (mounted.current) setPending(null)
    }
  }

  const copyBillId = async (billId: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(billId)
      setCopied(true)
      setTimeout(() => mounted.current && setCopied(false), 2000)
    } catch {
      setError('unknown')
    }
  }

  const back = (
    <button type="button" className="link inline-flex items-center gap-1 text-sm" onClick={onBack}>
      <ArrowLeft size={14} className="rtl:-scale-x-100" />
      {t('trips.backToList')}
    </button>
  )

  if (!details) {
    return (
      <section className="flex flex-col gap-4">
        <div>{back}</div>
        {error ? (
          <FormAlert message={t(`fleet.errors.${error}`)} />
        ) : (
          <div className="flex justify-center py-16 text-stone-400">
            <LoaderCircle className="animate-spin" />
          </div>
        )}
      </section>
    )
  }

  const { trip, payment, certificate } = details
  const cityById = (id: number): TripReferenceData['cities'][number] | undefined =>
    reference.cities.find((c) => c.id === id)
  const spinner = (action: Action): ReactNode =>
    pending === action && <LoaderCircle size={16} className="animate-spin" />

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          {back}
          <div className="mt-2 flex items-center gap-3">
            <h2 className="text-lg font-semibold text-stone-900">
              {t('trips.details.title', { id: format.number(trip.id) })}
            </h2>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATUS_STYLES[trip.status]}`}
            >
              {t(`statuses.${trip.status}`)}
            </span>
          </div>
          <p className="text-sm text-stone-500">
            {t('trips.details.subtitle', { date: format.date(trip.createdAt) })}
          </p>
        </div>
        {trip.status === 'draft' && (
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={pending !== null}
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 size={16} />
              {t('trips.details.delete')}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={pending !== null}
              onClick={() => onEdit(trip)}
            >
              <Pencil size={16} />
              {t('trips.details.edit')}
            </button>
          </div>
        )}
        {/* Demo control: kept out of the way so the main view looks like the real product */}
        {trip.status === 'billed' && payment && (
          <Menu
            label={t('trips.details.moreActions')}
            items={[
              {
                label: (
                  <>
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                      {t('billing.demo')}
                    </span>
                    <span dir="ltr" className="tabular-nums">
                      {t('billing.payDemo', { billId: payment.billId })}
                    </span>
                  </>
                ),
                disabled: pending !== null,
                onSelect: () => run('pay')
              }
            ]}
          />
        )}
      </div>

      {error && <FormAlert message={t(`fleet.errors.${error}`)} />}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="card p-6">
          <h3 className="mb-2 text-sm font-semibold text-stone-800">
            {t('trips.details.summary')}
          </h3>
          <dl className="divide-y divide-stone-100 text-sm">
            <Row label={t('trips.details.vehicle')}>
              <PlateBadge plate={trip.plateNumber} />
            </Row>
            <Row label={t('trips.details.vehicleType')}>
              {t(`vehicleTypes.${trip.vehicleType}`)}
            </Row>
            <Row label={t('trips.details.route')}>
              <span className="inline-flex items-center gap-1.5">
                {format.city(cityById(trip.originCityId))}
                <ArrowRight size={14} className="text-stone-400 rtl:-scale-x-100" />
                {format.city(cityById(trip.destinationCityId))}
              </span>
            </Row>
            <Row label={t('trips.details.cargo')}>
              {t(`cargoTypes.${trip.cargoType}`)} ·{' '}
              <span className="tabular-nums">
                {format.quantity(trip.cargoQuantity, trip.cargoUnit)}
              </span>
            </Row>
            <Row label={t('trips.details.tripDate')}>{format.date(trip.tripDate)}</Row>
            <Row label={t('trips.details.distance')}>
              <span className="tabular-nums">
                {t('units.km', { value: format.number(trip.distanceKm) })}
              </span>
            </Row>
          </dl>

          <h3 className="mt-6 mb-2 text-sm font-semibold text-stone-800">
            {t('trips.items.title')}
          </h3>
          {trip.items.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-xs text-stone-500">
                  <th className="w-8 py-2 text-start font-medium">#</th>
                  <th className="py-2 text-start font-medium">{t('trips.items.name')}</th>
                  <th className="py-2 text-end font-medium">{t('trips.items.quantity')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {trip.items.map((item, index) => (
                  <tr key={index}>
                    <td className="py-2 text-stone-400 tabular-nums">{format.number(index + 1)}</td>
                    <td className="py-2 text-stone-900">
                      <bdi>{item.name}</bdi>
                    </td>
                    <td className="py-2 text-end whitespace-nowrap tabular-nums">
                      {format.quantity(item.quantity, item.unit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-stone-500">{t('trips.items.none')}</p>
          )}

          <h3 className="mt-6 mb-2 text-sm font-semibold text-stone-800">{t('trips.tax.title')}</h3>
          <TaxBreakdown tripCost={trip.tripCost} lines={trip.taxes} total={trip.taxAmount} />
        </div>

        <aside className="card flex flex-col gap-4 p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
            <ReceiptText size={18} className="text-brand-700" />
            {t('billing.title')}
          </div>

          {!payment ? (
            <>
              <p className="text-sm text-stone-600">{t('billing.draft.body')}</p>
              <div className="flex items-baseline justify-between rounded-lg bg-stone-50 px-4 py-3">
                <span className="text-sm text-stone-500">{t('billing.amountDue')}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {format.currency(trip.taxAmount)}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending !== null}
                onClick={() => run('generate')}
              >
                {spinner('generate')}
                {t('billing.draft.generate')}
              </button>
            </>
          ) : payment.status !== 'paid' || !certificate ? (
            <>
              <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-4">
                <span className="text-xs font-medium text-amber-800">
                  {t('billing.pending.label')}
                </span>
                <div className="flex items-center justify-between gap-2">
                  <span
                    dir="ltr"
                    className="font-mono text-lg font-semibold tracking-wide text-stone-900 select-text"
                  >
                    {groupDigits(payment.billId)}
                  </span>
                  <button
                    type="button"
                    className="icon-btn shrink-0"
                    aria-label={copied ? t('billing.pending.copied') : t('billing.pending.copy')}
                    title={copied ? t('billing.pending.copied') : t('billing.pending.copy')}
                    onClick={() => copyBillId(payment.billId)}
                  >
                    {copied ? <Check size={16} className="text-brand-700" /> : <Copy size={16} />}
                  </button>
                </div>
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-stone-500">{t('billing.amountDue')}</span>
                  <span className="font-semibold tabular-nums">
                    {format.currency(payment.amount)}
                  </span>
                </div>
                <span className="text-xs text-stone-500">
                  {t('billing.pending.issuedAt', { date: format.dateTime(payment.createdAt) })}
                </span>
              </div>
              <p className="text-sm text-stone-600">{t('billing.pending.hint')}</p>
              {notPaid && <FormAlert message={t('billing.pending.notPaid')} />}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={pending !== null}
                onClick={() => run('refresh')}
              >
                {pending === 'refresh' ? spinner('refresh') : <RefreshCw size={16} />}
                {t('billing.pending.refresh')}
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-col items-center gap-2 rounded-lg bg-brand-50 px-4 py-5 text-center">
                <CircleCheckBig size={36} className="text-brand-700" />
                <span className="font-semibold text-brand-800">{t('billing.paid.title')}</span>
                <span className="text-sm text-brand-800/80">{t('billing.paid.body')}</span>
              </div>
              <dl className="divide-y divide-stone-100 text-sm">
                <Row label={t('billing.paid.billId')}>
                  <span dir="ltr" className="font-mono text-xs">
                    {payment.billId}
                  </span>
                </Row>
                <Row label={t('billing.amountDue')}>
                  <span className="tabular-nums">{format.currency(payment.amount)}</span>
                </Row>
                {payment.paidAt && (
                  <Row label={t('billing.paid.paidAt')}>{format.dateTime(payment.paidAt)}</Row>
                )}
                {payment.paymentRef && (
                  <Row label={t('billing.paid.paymentRef')}>
                    <span dir="ltr" className="font-mono text-xs">
                      {payment.paymentRef}
                    </span>
                  </Row>
                )}
                <Row label={t('billing.paid.certificateNo')}>
                  <span dir="ltr" className="font-mono text-xs">
                    {certificate.certificateNo}
                  </span>
                </Row>
                <Row label={t('billing.paid.validUntil')}>
                  {format.date(certificate.validUntil)}
                </Row>
              </dl>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setShowCertificate(true)}
              >
                <FileBadge size={16} />
                {t('billing.paid.show')}
              </button>
            </>
          )}
        </aside>
      </div>

      {confirmDelete && (
        <DeleteTripDialog
          trip={trip}
          reference={reference}
          onClose={() => setConfirmDelete(false)}
          onDeleted={onDeleted}
        />
      )}

      {showCertificate && certificate && payment && (
        <CertificateModal
          details={details}
          reference={reference}
          onClose={() => setShowCertificate(false)}
        />
      )}
    </section>
  )
}

export default TripDetails
