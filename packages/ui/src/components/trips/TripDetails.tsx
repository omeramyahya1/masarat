import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheckBig,
  Copy,
  Eye,
  FileBadge,
  FileText,
  LoaderCircle,
  Pencil,
  ReceiptText,
  RefreshCw,
  Trash2
} from 'lucide-react'
import {
  missingForBilling,
  tripCargoTypes,
  type FleetErrorCode,
  type Party,
  type TripRecord,
  type TripReferenceData
} from '@masarat/shared/fleet'
import type { TripDetails as TripDetailsData } from '@masarat/shared/billing'
import { formatSudanPhone } from '@masarat/shared/phone'
import { useAccount, useCan } from '../../lib/account'
import { useFormat } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FormAlert } from '../form/fields'
import PlateBadge from '../fleet/PlateBadge'
import Menu from '../ui/Menu'
import CertificateModal from './CertificateModal'
import DeleteTripDialog from './DeleteTripDialog'
import DocumentPreview from './DocumentPreview'
import { STATUS_STYLES } from './statusStyles'
import TaxBreakdown from './TaxBreakdown'
import { api } from '@masarat/api-client'

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

// A sender or receiver: name, address and phone, or a dash while the draft leaves them out
function PartyBlock({ title, party }: { title: string; party: Party }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-stone-200 p-3 text-sm">
      <span className="text-xs font-medium text-stone-500">{title}</span>
      <bdi className="font-medium text-stone-900">{party.name || '—'}</bdi>
      {party.address && <bdi className="text-stone-600">{party.address}</bdi>}
      {party.phone && (
        <span dir="ltr" className="text-stone-600 tabular-nums rtl:text-right">
          {party.phone}
        </span>
      )}
    </div>
  )
}

interface TripDetailsProps {
  tripId: number
  reference: TripReferenceData
  onBack: () => void
  // The government's view of any company's trip: nothing can be changed, and it shows whose trip
  // it is
  readOnly?: boolean
  // Opens the company's details, which the bill needs (its address and TIN)
  onGoToCompany?: () => void
  // Opens the form on this trip (drafts only)
  onEdit?: (trip: TripRecord) => void
  // The draft was deleted
  onDeleted?: () => void
  // The trip's status changed, so the list needs reloading
  onChanged?: () => void
}

const noop = (): void => undefined

function TripDetails({
  tripId,
  reference,
  onBack,
  readOnly = false,
  onGoToCompany = noop,
  onEdit = noop,
  onDeleted = noop,
  onChanged = noop
}: TripDetailsProps): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const { company } = useAccount()
  const can = useCan()
  // What the member's role lets them do here (the government's view changes nothing)
  const canEdit = !readOnly && can('trips.edit')
  const canBill = !readOnly && can('trips.bill')
  const [details, setDetails] = useState<TripDetailsData | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [pending, setPending] = useState<Action | null>(null)
  const [notPaid, setNotPaid] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showCertificate, setShowCertificate] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    ;(readOnly ? api.govt.getTrip(tripId) : api.billing.getTrip(tripId))
      .then((result) => {
        if (!mounted.current) return
        if (result.ok) setDetails(result.data)
        else setError(result.error)
      })
      .catch(() => mounted.current && setError('unknown'))
  }, [tripId, mounted, readOnly])

  const run = async (action: Action): Promise<void> => {
    setPending(action)
    setError(null)
    setNotPaid(false)
    try {
      if (action === 'pay') {
        const result = await api.billing.simulatePayment(tripId)
        if (mounted.current && !result.ok) setError(result.error)
        return
      }
      const result =
        action === 'generate'
          ? await api.billing.generate(tripId)
          : await api.billing.refresh(tripId)
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

  // The attachment previewed in the page (its index in the trip's documents)
  const [preview, setPreview] = useState<number | null>(null)

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
  const passengerTrip = trip.category === 'passenger'
  const cityById = (id: number): TripReferenceData['cities'][number] | undefined =>
    reference.cities.find((c) => c.id === id)
  const spinner = (action: Action): ReactNode =>
    pending === action && <LoaderCircle size={16} className="animate-spin" />
  // What the draft still needs before its bill can be generated
  const missing =
    !readOnly && company && trip.status === 'draft' ? missingForBilling(trip, company) : []
  const missingProfile = missing.some((m) => m === 'carrier_address' || m === 'carrier_tin')
  const missingTrip = missing.some((m) => m !== 'carrier_address' && m !== 'carrier_tin')

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
        {canEdit && trip.status === 'draft' && (
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
        {canBill && trip.status === 'billed' && payment && (
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
            {readOnly && (
              <Row label={t('trips.details.company')}>
                <bdi>{details.company.name}</bdi>
              </Row>
            )}
            <Row label={t('trips.details.branch')}>
              <bdi>{trip.branchName}</bdi>
            </Row>
            {readOnly && details.bookedBy && (
              <Row label={t('trips.details.bookedBy')}>
                <span className="inline-flex flex-col items-end">
                  <bdi>{details.bookedBy.fullName}</bdi>
                  <bdi dir="ltr" className="text-xs font-normal text-stone-500 tabular-nums">
                    {formatSudanPhone(details.bookedBy.phone)}
                  </bdi>
                </span>
              </Row>
            )}
            <Row label={t('trips.details.vehicle')}>
              <PlateBadge plate={trip.plateNumber} />
            </Row>
            <Row label={t('trips.details.vehicleType')}>
              {t(`vehicleTypes.${trip.vehicleType}`)}
            </Row>
            <Row label={t('fleet.fields.registrationNo')}>
              {trip.registrationNo ? (
                <bdi className="font-mono text-xs">{trip.registrationNo}</bdi>
              ) : (
                '—'
              )}
            </Row>
            {!passengerTrip && (
              <Row label={t('trips.trailers.title')}>
                {trip.trailers.length > 0 ? (
                  <span className="inline-flex flex-wrap justify-end gap-1.5">
                    {trip.trailers.map((plate) => (
                      <PlateBadge key={plate} plate={plate} />
                    ))}
                  </span>
                ) : (
                  t('trips.details.noTrailers')
                )}
              </Row>
            )}
            <Row label={t('trips.fields.driver')}>
              {trip.driverName ? (
                <span className="inline-flex flex-col items-end">
                  <bdi>{trip.driverName}</bdi>
                  <span dir="ltr" className="text-xs font-normal text-stone-500 tabular-nums">
                    {trip.driverPhone}
                  </span>
                </span>
              ) : (
                '—'
              )}
            </Row>
            <Row label={t('trips.details.category')}>{t(`tripCategories.${trip.category}`)}</Row>
            {!passengerTrip && (
              <Row label={t('trips.fields.tripKind')}>{t(`tripKinds.${trip.tripKind}`)}</Row>
            )}
            <Row label={t('trips.details.route')}>
              <span className="inline-flex items-center gap-1.5">
                {format.city(cityById(trip.originCityId))}
                <ArrowRight size={14} className="text-stone-400 rtl:-scale-x-100" />
                {format.city(cityById(trip.destinationCityId))}
              </span>
            </Row>
            {passengerTrip ? (
              <Row label={t('trips.details.passengers')}>
                <span className="tabular-nums">
                  {t('trips.passengers.counts', {
                    seated: format.number(trip.cargoQuantity),
                    seats: format.number(details.vehicleCapacity),
                    infants: format.number(trip.passengers.length - trip.cargoQuantity)
                  })}
                </span>
              </Row>
            ) : (
              <Row label={t('trips.details.cargo')}>
                {format.list(tripCargoTypes(trip).map((c) => t(`cargoTypes.${c}`)))} ·{' '}
                <span className="tabular-nums">
                  {format.quantity(trip.cargoQuantity, trip.cargoUnit)}
                </span>
              </Row>
            )}
            <Row label={t('trips.details.departureAt')}>{format.dateTime(trip.departureAt)}</Row>
            <Row label={t('trips.details.arrivalAt')}>{format.dateTime(trip.arrivalAt)}</Row>
            <Row label={t('trips.details.distance')}>
              <span className="tabular-nums">
                {t('units.km', { value: format.number(trip.distanceKm) })}
              </span>
            </Row>
          </dl>

          {!passengerTrip && (
            <>
              <h3 className="mt-6 mb-2 text-sm font-semibold text-stone-800">
                {t('trips.form.partiesSection')}
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <PartyBlock title={t('trips.party.shipper')} party={trip.shipper} />
                <PartyBlock title={t('trips.party.receiver')} party={trip.receiver} />
              </div>
            </>
          )}
          {trip.carrier && (
            <div className="mt-3">
              <PartyBlock
                title={t('trips.details.carrier')}
                party={{
                  name: trip.carrier.name,
                  address: trip.carrier.address,
                  phone: ''
                }}
              />
              <p className="mt-1 text-xs text-stone-500">
                {t('trips.details.carrierTin', { tin: trip.carrier.tin })}
              </p>
            </div>
          )}

          {!passengerTrip && (
            <>
              <h3 className="mt-6 mb-2 text-sm font-semibold text-stone-800">
                {t('trips.documents.title')}
              </h3>
              {trip.documents.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {trip.documents.map((document, index) => (
                    <li
                      key={document.id}
                      className="flex items-center gap-3 rounded-lg border border-stone-200 px-3 py-2 text-sm"
                    >
                      <FileText size={16} className="shrink-0 text-stone-400" />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium text-stone-800">
                          {t(`documentTypes.${document.docType}`)}
                        </span>
                        <span className="truncate text-xs text-stone-500" dir="auto">
                          {document.fileName} · {format.fileSize(document.size)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        aria-label={t('trips.documents.openOf', {
                          name: t(`documentTypes.${document.docType}`)
                        })}
                        onClick={() => setPreview(index)}
                      >
                        <Eye size={14} />
                        {t('trips.documents.open')}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-stone-500">{t('trips.documents.empty')}</p>
              )}

              <h3 className="mt-6 mb-2 text-sm font-semibold text-stone-800">
                {t('trips.items.title')}
              </h3>
              {trip.items.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-xs text-stone-500">
                      <th className="w-8 py-2 text-start font-medium">#</th>
                      <th className="py-2 text-start font-medium">{t('trips.items.name')}</th>
                      <th className="py-2 text-start font-medium">{t('trips.items.type')}</th>
                      <th className="py-2 text-start font-medium">
                        {t('trips.items.packingType')}
                      </th>
                      <th className="py-2 text-end font-medium">{t('trips.items.packageCount')}</th>
                      <th className="py-2 text-end font-medium">{t('trips.items.quantity')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {trip.items.map((item, index) => (
                      <tr key={index}>
                        <td className="py-2 text-stone-400 tabular-nums">
                          {format.number(index + 1)}
                        </td>
                        <td className="py-2 text-stone-900">
                          <bdi>{item.name}</bdi>
                          {item.notes && (
                            <bdi className="block text-xs text-stone-500">{item.notes}</bdi>
                          )}
                        </td>
                        <td className="py-2 text-stone-600">{t(`cargoTypes.${item.cargoType}`)}</td>
                        <td className="py-2 text-stone-600">
                          {item.packingType ? <bdi>{item.packingType}</bdi> : '—'}
                        </td>
                        <td className="py-2 text-end tabular-nums">
                          {item.packageCount !== null ? format.number(item.packageCount) : '—'}
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
            </>
          )}

          {passengerTrip && (
            <>
              <h3 className="mt-6 mb-2 text-sm font-semibold text-stone-800">
                {t('trips.form.passengersSection')}
              </h3>
              {trip.passengers.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-xs text-stone-500">
                      <th className="w-12 py-2 text-start font-medium">
                        {t('trips.passengers.seat')}
                      </th>
                      <th className="py-2 text-start font-medium">{t('trips.passengers.name')}</th>
                      <th className="py-2 text-start font-medium">
                        {t('trips.passengers.idNumber')}
                      </th>
                      <th className="py-2 text-start font-medium">{t('trips.passengers.notes')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {[...trip.passengers]
                      .sort(
                        (a, b) => a.seatNo - b.seatNo || Number(a.isInfant) - Number(b.isInfant)
                      )
                      .map((p, index) => (
                        <tr key={index} className={p.isInfant ? 'text-stone-500' : undefined}>
                          <td className="py-2 tabular-nums">{format.number(p.seatNo)}</td>
                          <td className="py-2 text-stone-900">
                            <bdi>{p.fullName}</bdi>
                            {p.isInfant && (
                              <span className="ms-2 rounded bg-stone-100 px-1.5 text-[11px] text-stone-600">
                                {t('trips.passengers.infant')}
                              </span>
                            )}
                          </td>
                          <td className="py-2">
                            {p.idType && p.idNumber ? (
                              <span className="inline-flex flex-col">
                                <span className="text-[11px] text-stone-500">
                                  {t(`idTypes.${p.idType}`)}
                                </span>
                                <bdi dir="ltr" className="font-mono text-xs">
                                  {p.idNumber}
                                </bdi>
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-2 text-xs">
                            <bdi>{p.notes ?? ''}</bdi>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-stone-500">{t('trips.passengers.empty')}</p>
              )}
              <p className="mt-2 text-xs text-stone-500">
                {trip.ticketPrice !== null &&
                  t('trips.passengers.fare', {
                    price: format.currency(trip.ticketPrice),
                    tickets: format.number(trip.cargoQuantity)
                  })}
              </p>
            </>
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
              <p className="text-sm text-stone-600">
                {t(readOnly ? 'billing.draft.govtBody' : 'billing.draft.body')}
              </p>
              <div className="flex items-baseline justify-between rounded-lg bg-stone-50 px-4 py-3">
                <span className="text-sm text-stone-500">{t('billing.amountDue')}</span>
                <span className="text-lg font-semibold tabular-nums">
                  {format.currency(trip.taxAmount)}
                </span>
              </div>
              {missing.length > 0 && (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-4 text-sm">
                  <span className="flex items-center gap-2 font-medium text-amber-900">
                    <CircleAlert size={16} className="shrink-0" />
                    {t('billing.missing.title')}
                  </span>
                  <ul className="list-disc ps-6 text-amber-900">
                    {missing.map((requirement) => (
                      <li key={requirement}>{t(`billing.missing.${requirement}`)}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-3">
                    {missingTrip && canEdit && (
                      <button type="button" className="link text-sm" onClick={() => onEdit(trip)}>
                        {t('billing.missing.editTrip')}
                      </button>
                    )}
                    {missingProfile && can('company.profile') && (
                      <button type="button" className="link text-sm" onClick={onGoToCompany}>
                        {t('billing.missing.openProfile')}
                      </button>
                    )}
                  </div>
                </div>
              )}
              {canBill && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={pending !== null || missing.length > 0}
                  onClick={() => run('generate')}
                >
                  {spinner('generate')}
                  {t('billing.draft.generate')}
                </button>
              )}
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
              {canBill && (
                <>
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
              )}
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
                <Row label={t('billing.paid.manifestNo')}>
                  <span dir="ltr" className="font-mono text-xs">
                    {certificate.manifestNo}
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
      {preview !== null && (
        <DocumentPreview
          documents={details.trip.documents}
          startIndex={preview}
          load={readOnly ? api.govt.documentFile : api.documents.file}
          onClose={() => setPreview(null)}
        />
      )}
    </section>
  )
}

export default TripDetails
