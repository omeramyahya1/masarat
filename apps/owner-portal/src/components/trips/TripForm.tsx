import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Calculator, Info, LoaderCircle, Truck, Wand2 } from 'lucide-react'
import {
  MAX_DOCUMENT_BYTES,
  TRIP_KINDS,
  documentTypesFor,
  totalInVehicleUnit,
  tripCategoryFor,
  type CargoType,
  type DocumentType,
  type DriverRecord,
  type FleetErrorCode,
  type Party,
  type TripKind,
  type TripRecord,
  type TripReferenceData,
  type TripSuggestions,
  type VehicleRecord
} from '@masarat/shared/fleet'
import { parsePlate } from '@masarat/shared/plate'
import {
  ROAD_FACTOR,
  calculateItemsCost,
  calculateCharges,
  calculateTicketPrice,
  estimateRoadKm
} from '@masarat/shared/tax'
import { normalizeIdNumber } from '@masarat/shared/passengers'
import {
  addMinutes,
  sudanInstant,
  suggestedSudanArrival,
  toSudanDateTime
} from '@masarat/shared/settings'
import type { TemplateRecord } from '@masarat/shared/templates'
import type { BranchRecord } from '@masarat/shared/members'
import { useAccount, useCan } from '@masarat/ui/lib/account'
import { useFormat } from '@masarat/ui/lib/format'
import { plateValueToString, type PlateValue } from '@masarat/ui/lib/plateValue'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import {
  FieldLabel,
  FormAlert,
  SelectField,
  SubmitButton
} from '@masarat/ui/components/form/fields'
import PlateBadge from '@masarat/ui/components/fleet/PlateBadge'
import CargoItemsEditor from './CargoItemsEditor'
import DocumentsField, { type DocumentDraft } from './DocumentsField'
import DriverField from './DriverField'
import PartyFields from './PartyFields'
import TrailersField from './TrailersField'
import { fitItemsTo, newItemDraft, type ItemDraft } from './itemDrafts'
import PassengersEditor from './PassengersEditor'
import {
  newPassengerDraft,
  orphanInfants,
  seatConflicts,
  type PassengerDraft
} from './passengerDrafts'
import TaxBreakdown from '@masarat/ui/components/trips/TaxBreakdown'
import { api } from '@masarat/api-client'

const EMPTY_PARTY: Party = { name: '', address: '', phone: '' }

// A stored plate as the plate input edits it
function toPlateValue(plate: string): PlateValue {
  const parts = parsePlate(plate)
  return parts
    ? { code: parts.code, series: String(parts.series), number: String(parts.number) }
    : { code: '', series: '', number: '' }
}

// Times on this form are Sudan's wall-clock times ("YYYY-MM-DDTHH:MM"), whatever the browser's
// zone: the API reads them in Sudan time too (parseLocalDateTime)

// A new trip from a template leaves today at the template's time, or tomorrow once that's past
function templateDeparture(template: TemplateRecord): string {
  const now = toSudanDateTime(Date.now())
  const today = `${now.slice(0, 10)}T${template.departureTime}`
  return today > now ? today : (addMinutes(today, 24 * 60) ?? today)
}

// Today at 08:00, for a new trip without a template
const defaultDeparture = (): string => `${toSudanDateTime(Date.now()).slice(0, 10)}T08:00`

interface TripFormProps {
  reference: TripReferenceData
  // The company's branches, for members who book at any of them
  branches: readonly BranchRecord[]
  // A draft to edit; without it the form creates a new trip
  trip?: TripRecord
  // A passenger trip template to start a new trip from
  template?: TemplateRecord
  onCancel: () => void
  onSaved: (trip: TripRecord) => void
  onGoToVehicles: () => void
}

function TripForm({
  reference,
  branches,
  trip,
  template,
  onCancel,
  onSaved,
  onGoToVehicles
}: TripFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const can = useCan()
  const account = useAccount()
  // A branch member books at their own branch; anyone else picks one
  const ownBranch = account.role.scope === 'branch' ? account.branch : null
  const openBranches = branches.filter((b) => b.active)
  const [branchId, setBranchId] = useState(() =>
    trip
      ? String(trip.branchId)
      : template
        ? String(template.branchId)
        : openBranches.length === 1
          ? String(openBranches[0].id)
          : ''
  )
  const departureId = useId()
  const arrivalId = useId()
  const kindId = useId()
  const [vehicles, setVehicles] = useState<VehicleRecord[] | null>(null)
  const from = trip ?? template
  const [vehicleId, setVehicleId] = useState(from ? String(from.vehicleId) : '')
  const [originId, setOriginId] = useState(from ? String(from.originCityId) : '')
  const [destinationId, setDestinationId] = useState(from ? String(from.destinationCityId) : '')
  const [items, setItems] = useState<ItemDraft[]>(() => {
    if (!trip || trip.category === 'passenger') return [newItemDraft('ton', '')]
    if (trip.items.length > 0) return trip.items.map((item) => newItemDraft(item.unit, '', item))
    // A trip from before cargo items existed: start from its cargo type and quantity
    const unit = trip.cargoUnit === 'liter' ? 'liter' : 'ton'
    return [
      newItemDraft(unit, trip.cargoType ?? '', {
        name: '',
        quantity: trip.cargoQuantity,
        unit,
        cargoType: trip.cargoType ?? 'general_cargo',
        packingType: null,
        packageCount: null,
        notes: null
      })
    ]
  })
  const [passengers, setPassengers] = useState<PassengerDraft[]>(() =>
    (trip?.passengers ?? []).map((p) => newPassengerDraft(p))
  )
  // When it leaves, and the estimated arrival: suggested from the distance at the government's
  // average speed until the member types their own
  const [departureAt, setDepartureAt] = useState(() =>
    trip
      ? toSudanDateTime(trip.departureAt)
      : template
        ? templateDeparture(template)
        : defaultDeparture()
  )
  const [arrivalEdited, setArrivalEdited] = useState<string | null>(() =>
    trip
      ? toSudanDateTime(trip.arrivalAt)
      : template
        ? addMinutes(templateDeparture(template), template.durationMinutes)
        : null
  )

  const [tripKind, setTripKind] = useState<TripKind>(trip?.tripKind ?? 'domestic')
  const [trailers, setTrailers] = useState<PlateValue[]>(() =>
    (trip?.trailers ?? []).map(toPlateValue)
  )
  const [drivers, setDrivers] = useState<DriverRecord[]>([])
  const [driverId, setDriverId] = useState(from?.driverId ? String(from.driverId) : '')
  const [shipper, setShipper] = useState<Party>(trip?.shipper ?? EMPTY_PARTY)
  const [receiver, setReceiver] = useState<Party>(trip?.receiver ?? EMPTY_PARTY)
  const [suggestions, setSuggestions] = useState<TripSuggestions>({
    parties: [],
    packingTypes: []
  })
  const [documents, setDocuments] = useState<DocumentDraft[]>(() => trip?.documents ?? [])
  const [documentBusy, setDocumentBusy] = useState<DocumentType | null>(null)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [pending, setPending] = useState(false)
  const mounted = useMountedRef()

  useEffect(() => {
    Promise.all([api.fleet.listVehicles(), api.fleet.listDrivers(), api.trips.suggestions()])
      .then(([vehicleList, driverList, suggested]) => {
        if (driverList.ok) setDrivers(driverList.data)
        if (suggested.ok) setSuggestions(suggested.data)
        if (vehicleList.ok) setVehicles(vehicleList.data)
        else setError(vehicleList.error)
      })
      .catch(() => setError('unknown'))
  }, [])

  const vehicle = vehicles?.find((v) => String(v.id) === vehicleId)
  // A bus carries passengers; anything else cargo
  const category = vehicle ? tripCategoryFor(vehicle.vehicleType) : 'cargo'
  const passengerTrip = category === 'passenger'
  // Each item is measured in its cargo type's rate unit, so only offer cargo the vehicle can carry
  const cargoTypesFor = (v: VehicleRecord): CargoType[] =>
    reference.cargoRates.filter((r) => r.unit === v.capacityUnit).map((r) => r.cargoType)
  const origin = reference.cities.find((c) => String(c.id) === originId)
  const destination = reference.cities.find((c) => String(c.id) === destinationId)
  const parsedItems = items.map((item) => ({
    name: item.name.trim(),
    quantity: Number(item.quantity),
    unit: item.unit,
    cargoType: item.cargoType,
    packingType: item.packingType.trim() || null,
    packageCount: item.packageCount === '' ? null : Number(item.packageCount),
    notes: item.notes.trim() || null
  }))
  const countedItems = parsedItems.filter(
    (item): item is typeof item & { cargoType: CargoType } =>
      item.quantity > 0 && Number.isFinite(item.quantity) && item.cargoType !== ''
  )
  const quantityValue = totalInVehicleUnit(
    parsedItems.filter((item) => item.quantity > 0 && Number.isFinite(item.quantity))
  )
  const overCapacity = Boolean(vehicle && quantityValue > vehicle.capacity)

  const cityOptions = useMemo(
    () =>
      reference.cities
        .map((c) => ({ value: String(c.id), label: format.city(c) }))
        .sort((a, b) => a.label.localeCompare(b.label, format.isArabic ? 'ar' : 'en')),
    [reference.cities, format]
  )

  const distanceKm =
    origin && destination && origin.id !== destination.id
      ? estimateRoadKm(origin, destination)
      : null
  const priced =
    distanceKm !== null && countedItems.length > 0
      ? calculateItemsCost(countedItems, reference.cargoRates, distanceKm)
      : null
  // A passenger trip: the ticket price for the distance, times the tickets (infants have none)
  const ticketPrice =
    distanceKm !== null ? calculateTicketPrice(reference.ticketRatePerKm, distanceKm) : null
  const tickets = passengers.filter((p) => !p.isInfant).length
  const tripCost = passengerTrip
    ? ticketPrice !== null
      ? ticketPrice * tickets
      : null
    : (priced?.total ?? null)
  const departure = sudanInstant(departureAt)
  const suggested =
    departure !== null && distanceKm !== null
      ? suggestedSudanArrival(departureAt, distanceKm, reference.averageSpeedKmh[category])
      : null
  const arrivalAt = arrivalEdited ?? suggested ?? ''
  // Cost and quantity per cargo type, for the summary
  const costByType = new Map<CargoType, { cost: number; quantity: number }>()
  countedItems.forEach((item, index) => {
    const entry = costByType.get(item.cargoType) ?? { cost: 0, quantity: 0 }
    entry.cost += priced?.costs[index] ?? 0
    entry.quantity += totalInVehicleUnit([item])
    costByType.set(item.cargoType, entry)
  })
  // Previewed with today's percentages and fees; the bill uses the ones current when it's issued
  const taxes = calculateCharges(tripCost ?? 0, reference.charges, category)

  const handleVehicleChange = (id: string): void => {
    setVehicleId(id)
    const next = vehicles?.find((v) => String(v.id) === id)
    if (!next || next.capacityUnit === 'seat') return
    const unit = next.capacityUnit
    setItems((current) => fitItemsTo(current, unit, cargoTypesFor(next)))
  }

  const attachDocument = async (docType: DocumentType, file: File): Promise<void> => {
    setError(null)
    // Too big to send: say so without uploading it first
    if (file.size > MAX_DOCUMENT_BYTES) return setError('document_too_large')
    setDocumentBusy(docType)
    try {
      const result = await api.documents.upload(docType, file)
      if (!mounted.current) return
      if (!result.ok) return setError(result.error)
      const uploaded = result.data
      setDocuments((current) => [...current.filter((d) => d.docType !== docType), uploaded])
    } catch {
      if (mounted.current) setError('unknown')
    } finally {
      if (mounted.current) setDocumentBusy(null)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!ownBranch && !branchId) return setError('branch_required')
    if (!vehicle || !origin || !destination || !departureAt) {
      setError('missing_fields')
      return
    }
    if (origin.id === destination.id) return setError('same_route')
    const arrival = sudanInstant(arrivalAt)
    if (departure === null || arrival === null) return setError('invalid_date')
    if (arrival <= departure) return setError('invalid_arrival')
    if (passengerTrip) {
      if (seatConflicts(passengers).size > 0) return setError('seat_taken')
      if (orphanInfants(passengers).size > 0) return setError('invalid_passengers')
      if (tickets > vehicle.capacity) return setError('over_capacity')
      const invalid = passengers.some(
        (p) =>
          !p.fullName.trim() ||
          !p.seatNo ||
          (p.idNumber.trim() !== '' && !normalizeIdNumber(p.idType, p.idNumber))
      )
      if (invalid) return setError('invalid_passengers')
    } else {
      if (countedItems.length !== parsedItems.length || parsedItems.some((item) => !item.name)) {
        return setError('invalid_items')
      }
      if (overCapacity) return setError('over_capacity')
    }
    // Trailer rows left completely empty are dropped; any other row has to be a valid plate
    const trailerPlates = trailers
      .filter((p) => p.code || p.series || p.number)
      .map(plateValueToString)
    if (trailerPlates.some((plate) => plate === null)) return setError('invalid_trailer')
    if (parsedItems.some((item) => item.packageCount === 0)) return setError('invalid_items')

    setError(null)
    setPending(true)
    try {
      const input = {
        branchId: ownBranch ? ownBranch.id : Number(branchId),
        vehicleId: vehicle.id,
        originCityId: origin.id,
        destinationCityId: destination.id,
        items: passengerTrip ? [] : countedItems,
        passengers: passengerTrip
          ? passengers.map((p) => ({
              fullName: p.fullName,
              idType: p.idNumber.trim() ? p.idType : null,
              idNumber: p.idNumber.trim() || null,
              seatNo: Number(p.seatNo),
              isInfant: p.isInfant,
              notes: p.notes.trim() || null
            }))
          : [],
        departureAt,
        arrivalAt,
        tripKind,
        trailers: trailerPlates as string[],
        driverId: driverId ? Number(driverId) : null,
        shipper,
        receiver,
        // Documents of types the trip no longer needs (its type changed) are dropped
        documents: documents
          .filter((d) => documentTypesFor(tripKind, category).includes(d.docType))
          .map((d) =>
            d.id !== undefined
              ? { docType: d.docType, id: d.id }
              : { docType: d.docType, token: d.token ?? '' }
          )
      }
      const result = trip ? await api.trips.update(trip.id, input) : await api.trips.create(input)
      // The user may have left this form (and opened a new one) while the request was in flight
      if (!mounted.current) return
      if (result.ok) onSaved(result.data)
      else setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  if (vehicles === null) {
    return (
      <div className="flex justify-center py-16 text-stone-400">
        {error ? (
          <FormAlert message={t(`fleet.errors.${error}`)} />
        ) : (
          <LoaderCircle className="animate-spin" />
        )}
      </div>
    )
  }

  if (vehicles.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-brand-50 text-brand-700">
          <Truck size={24} />
        </div>
        <h3 className="font-semibold text-stone-900">{t('trips.noVehicles.title')}</h3>
        <p className="max-w-sm text-sm text-stone-500">{t('trips.noVehicles.body')}</p>
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('common.back')}
          </button>
          {can('fleet.manage') && (
            <button type="button" className="btn btn-primary" onClick={onGoToVehicles}>
              {t('trips.noVehicles.action')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <form
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]"
      onSubmit={handleSubmit}
      noValidate
    >
      <div className="card flex flex-col gap-5 p-6">
        {error && <FormAlert message={t(`fleet.errors.${error}`)} />}

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-3 text-sm font-semibold text-stone-800">
            {t('trips.form.vehicleSection')}
          </legend>
          {ownBranch ? (
            <p className="text-sm text-stone-600">
              {t('trips.form.bookedAt', { branch: ownBranch.name })}
            </p>
          ) : (
            <SelectField
              label={t('trips.fields.branch')}
              placeholder={t('trips.fields.branchPlaceholder')}
              value={branchId}
              options={branches
                // A closed branch stays listed only for a trip already booked there
                .filter((b) => b.active || String(b.id) === branchId)
                .map((b) => ({ value: String(b.id), label: b.name }))}
              onChange={(e) => setBranchId(e.target.value)}
            />
          )}
          <SelectField
            label={t('trips.fields.vehicle')}
            placeholder={t('trips.fields.vehiclePlaceholder')}
            value={vehicleId}
            options={vehicles.map((v) => ({
              value: String(v.id),
              label: `${format.plate(v.plateNumber)} · ${t(`vehicleTypes.${v.vehicleType}`)}`
            }))}
            onChange={(e) => handleVehicleChange(e.target.value)}
          />
          {vehicle && (
            <div className="flex items-center gap-3 text-sm text-stone-600">
              <PlateBadge plate={vehicle.plateNumber} />
              <span>
                {t('trips.form.vehicleCapacity', {
                  capacity: format.quantity(vehicle.capacity, vehicle.capacityUnit)
                })}
              </span>
            </div>
          )}
          {!passengerTrip && (
            <div className="flex flex-col gap-2">
              <span className="label">{t('trips.trailers.title')}</span>
              <TrailersField value={trailers} onChange={setTrailers} />
            </div>
          )}
          <DriverField
            drivers={drivers}
            value={driverId}
            canAdd={can('drivers.manage')}
            onChange={setDriverId}
            onAdded={(driver) => {
              setDrivers((current) =>
                [...current, driver].sort((a, b) => a.name.localeCompare(b.name))
              )
              setDriverId(String(driver.id))
            }}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-4 border-t border-stone-200 pt-5">
          <legend className="mb-3 text-sm font-semibold text-stone-800">
            {t('trips.form.routeSection')}
          </legend>
          <div className={`flex flex-col gap-1.5 ${passengerTrip ? 'hidden' : ''}`}>
            <span className="label" id={kindId}>
              {t('trips.fields.tripKind')}
            </span>
            <div
              role="radiogroup"
              aria-labelledby={kindId}
              className="flex w-fit gap-1 rounded-lg border border-stone-200 bg-stone-100 p-1"
            >
              {TRIP_KINDS.map((kind) => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={tripKind === kind}
                  className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                    tripKind === kind
                      ? 'bg-white text-brand-800 shadow-sm ring-1 ring-stone-200'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                  onClick={() => setTripKind(kind)}
                >
                  {t(`tripKinds.${kind}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label={t('trips.fields.origin')}
              placeholder={t('trips.fields.cityPlaceholder')}
              value={originId}
              options={cityOptions}
              onChange={(e) => {
                setOriginId(e.target.value)
                if (e.target.value === destinationId) setDestinationId('')
              }}
            />
            <SelectField
              label={t('trips.fields.destination')}
              placeholder={t('trips.fields.cityPlaceholder')}
              value={destinationId}
              options={cityOptions.filter((c) => c.value !== originId)}
              onChange={(e) => setDestinationId(e.target.value)}
            />
          </div>
          {passengerTrip && (
            <p className="text-xs text-stone-500">{t('trips.form.domesticOnly')}</p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={departureId} label={t('trips.fields.departureAt')} />
              <input
                id={departureId}
                type="datetime-local"
                className="input"
                value={departureAt}
                onChange={(e) => setDepartureAt(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor={arrivalId} label={t('trips.fields.arrivalAt')} />
              <input
                id={arrivalId}
                type="datetime-local"
                className="input"
                value={arrivalAt}
                onChange={(e) => setArrivalEdited(e.target.value)}
              />
              {suggested && arrivalEdited !== null && arrivalEdited !== suggested ? (
                <button
                  type="button"
                  className="link inline-flex w-fit items-center gap-1 text-xs"
                  onClick={() => setArrivalEdited(null)}
                >
                  <Wand2 size={12} />
                  {t('trips.form.useSuggested', {
                    time: format.dateTime(sudanInstant(suggested) ?? 0)
                  })}
                </button>
              ) : (
                suggested && (
                  <p className="field-hint">
                    {t('trips.form.suggestedHint', {
                      speed: format.number(reference.averageSpeedKmh[category])
                    })}
                  </p>
                )
              )}
            </div>
          </div>
        </fieldset>

        {!passengerTrip && (
          <>
            <fieldset className="flex flex-col gap-3 border-t border-stone-200 pt-5">
              <legend className="mb-3 text-sm font-semibold text-stone-800">
                {t('trips.form.documentsSection')}
              </legend>
              <p className="text-xs text-stone-500">{t('trips.documents.hint')}</p>
              <DocumentsField
                tripKind={tripKind}
                value={documents}
                busy={documentBusy}
                onAttach={attachDocument}
                onRemove={(docType) => setDocuments(documents.filter((d) => d.docType !== docType))}
              />
            </fieldset>

            <fieldset className="flex flex-col gap-4 border-t border-stone-200 pt-5">
              <legend className="mb-3 text-sm font-semibold text-stone-800">
                {t('trips.form.partiesSection')}
              </legend>
              <div className="grid gap-6 sm:grid-cols-2">
                <PartyFields
                  legend={t('trips.party.shipper')}
                  value={shipper}
                  suggestions={suggestions.parties}
                  onChange={setShipper}
                />
                <PartyFields
                  legend={t('trips.party.receiver')}
                  value={receiver}
                  suggestions={suggestions.parties}
                  onChange={setReceiver}
                />
              </div>
            </fieldset>
          </>
        )}

        {passengerTrip && vehicle ? (
          <fieldset className="flex flex-col gap-4 border-t border-stone-200 pt-5">
            <legend className="mb-3 text-sm font-semibold text-stone-800">
              {t('trips.form.passengersSection')}
            </legend>
            <PassengersEditor
              passengers={passengers}
              seats={vehicle.capacity}
              onChange={setPassengers}
            />
          </fieldset>
        ) : (
          <fieldset className="flex flex-col gap-4 border-t border-stone-200 pt-5">
            <legend className="mb-3 text-sm font-semibold text-stone-800">
              {t('trips.form.cargoSection')}
            </legend>
            <div className="flex flex-col gap-2">
              <span className="label">{t('trips.items.title')}</span>
              {vehicle && vehicle.capacityUnit !== 'seat' ? (
                <CargoItemsEditor
                  items={items}
                  unit={vehicle.capacityUnit}
                  cargoTypes={cargoTypesFor(vehicle)}
                  total={quantityValue}
                  capacity={vehicle.capacity}
                  usedPackingTypes={suggestions.packingTypes}
                  onChange={setItems}
                />
              ) : (
                <p className="text-sm text-stone-500">{t('trips.items.chooseVehicle')}</p>
              )}
            </div>
          </fieldset>
        )}

        <div className="flex justify-end gap-2 border-t border-stone-200 pt-5">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <SubmitButton
            pending={pending}
            className=""
            label={t(trip ? 'trips.form.save' : 'trips.form.submit')}
          />
        </div>
      </div>

      <aside className="card sticky top-0 flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2 text-sm font-semibold text-stone-800">
          <Calculator size={18} className="text-brand-700" />
          {t('trips.tax.title')}
        </div>

        <dl className="flex flex-col gap-3 text-sm">
          <SummaryRow label={t('trips.tax.route')}>
            {origin && destination ? (
              <span className="inline-flex items-center gap-1.5">
                {format.city(origin)}
                <ArrowRight size={14} className="text-stone-400 rtl:-scale-x-100" />
                {format.city(destination)}
              </span>
            ) : (
              '—'
            )}
          </SummaryRow>
          <SummaryRow label={t('trips.tax.distance')}>
            {distanceKm !== null ? t('units.km', { value: format.number(distanceKm) }) : '—'}
          </SummaryRow>
          {passengerTrip ? (
            <>
              <SummaryRow label={t('trips.tax.ticketPrice')}>
                {ticketPrice !== null ? format.currency(ticketPrice) : '—'}
              </SummaryRow>
              <SummaryRow label={t('trips.tax.tickets')}>{format.number(tickets)}</SummaryRow>
            </>
          ) : (
            <SummaryRow label={t('trips.tax.quantity')}>
              {vehicle && quantityValue > 0
                ? format.quantity(quantityValue, vehicle.capacityUnit)
                : '—'}
            </SummaryRow>
          )}
        </dl>

        {!passengerTrip && costByType.size > 0 && distanceKm !== null && (
          <ul className="flex flex-col gap-2 border-t border-stone-200 pt-3 text-sm">
            {[...costByType].map(([type, entry]) => {
              const rate = reference.cargoRates.find((r) => r.cargoType === type)
              return (
                <li key={type} className="flex items-start justify-between gap-4">
                  <div className="flex flex-col">
                    <span className="text-stone-700">{t(`cargoTypes.${type}`)}</span>
                    {rate && (
                      <span className="text-xs text-stone-500 tabular-nums">
                        {format.quantity(entry.quantity, rate.unit)} ·{' '}
                        {t(
                          `trips.tax.${rate.perQuantity === 1 ? 'rateValuePerOne' : 'rateValue'}.${rate.unit}`,
                          {
                            rate: format.currency(rate.ratePerKm),
                            per: format.number(rate.perQuantity)
                          }
                        )}
                      </span>
                    )}
                  </div>
                  <span className="font-medium whitespace-nowrap text-stone-900 tabular-nums">
                    {format.currency(entry.cost)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}

        <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
          <TaxBreakdown
            tripCost={tripCost}
            lines={taxes.lines}
            total={tripCost !== null ? taxes.total : null}
          />
        </div>

        <p className="flex gap-2 text-xs text-stone-500">
          <Info size={14} className="mt-0.5 shrink-0" />
          {t('trips.tax.distanceNote', { factor: format.number(ROAD_FACTOR) })}
        </p>
      </aside>
    </form>
  )
}

function SummaryRow({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-end font-medium text-stone-900">{children}</dd>
    </div>
  )
}

export default TripForm
