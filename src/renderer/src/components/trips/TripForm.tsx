import { useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Calculator, Info, LoaderCircle, Truck } from 'lucide-react'
import type {
  CargoType,
  FleetErrorCode,
  TripRecord,
  TripReferenceData,
  VehicleRecord
} from '../../../../shared/fleet'
import { ROAD_FACTOR, calculateTax, estimateRoadKm } from '../../../../shared/tax'
import { todayIso, useFormat } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FieldLabel, FormAlert, NumberField, SelectField, SubmitButton } from '../form/fields'
import PlateBadge from '../fleet/PlateBadge'

interface TripFormProps {
  reference: TripReferenceData
  onCancel: () => void
  onCreated: (trip: TripRecord) => void
  onGoToVehicles: () => void
}

function TripForm({
  reference,
  onCancel,
  onCreated,
  onGoToVehicles
}: TripFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const dateId = useId()
  const [vehicles, setVehicles] = useState<VehicleRecord[] | null>(null)
  const [vehicleId, setVehicleId] = useState('')
  const [originId, setOriginId] = useState('')
  const [destinationId, setDestinationId] = useState('')
  const [cargoType, setCargoType] = useState<CargoType | ''>('')
  const [quantity, setQuantity] = useState('')
  const [tripDate, setTripDate] = useState(todayIso)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [pending, setPending] = useState(false)
  const mounted = useMountedRef()

  useEffect(() => {
    window.api.fleet
      .listVehicles()
      .then((result) => {
        if (result.ok) setVehicles(result.data)
        else setError(result.error)
      })
      .catch(() => setError('unknown'))
  }, [])

  const vehicle = vehicles?.find((v) => String(v.id) === vehicleId)
  // Cargo is measured in its tax rate's unit, so only offer cargo the vehicle can carry
  const allowedRates = reference.taxRates.filter((r) => !vehicle || r.unit === vehicle.capacityUnit)
  const rate = reference.taxRates.find((r) => r.cargoType === cargoType)
  const origin = reference.cities.find((c) => String(c.id) === originId)
  const destination = reference.cities.find((c) => String(c.id) === destinationId)
  const quantityValue = Number(quantity)
  const overCapacity = Boolean(vehicle && quantity !== '' && quantityValue > vehicle.capacity)

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
  const tax =
    distanceKm !== null && rate && quantityValue > 0
      ? calculateTax(rate, distanceKm, quantityValue)
      : null

  const handleVehicleChange = (id: string): void => {
    setVehicleId(id)
    const next = vehicles?.find((v) => String(v.id) === id)
    if (next && rate && rate.unit !== next.capacityUnit) setCargoType('')
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!vehicle || !origin || !destination || !cargoType || quantity === '' || !tripDate) {
      setError('missing_fields')
      return
    }
    if (origin.id === destination.id) return setError('same_route')
    if (!(quantityValue > 0)) return setError('invalid_quantity')
    if (overCapacity) return setError('over_capacity')

    setError(null)
    setPending(true)
    try {
      const result = await window.api.trips.create({
        vehicleId: vehicle.id,
        originCityId: origin.id,
        destinationCityId: destination.id,
        cargoType,
        cargoQuantity: quantityValue,
        tripDate
      })
      // The user may have left this form (and opened a new one) while the request was in flight
      if (!mounted.current) return
      if (result.ok) onCreated(result.data)
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
          <button type="button" className="btn btn-primary" onClick={onGoToVehicles}>
            {t('trips.noVehicles.action')}
          </button>
        </div>
      </div>
    )
  }

  const unit = vehicle?.capacityUnit ?? rate?.unit

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
        </fieldset>

        <fieldset className="flex flex-col gap-4 border-t border-stone-200 pt-5">
          <legend className="mb-3 text-sm font-semibold text-stone-800">
            {t('trips.form.routeSection')}
          </legend>
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
          <div className="flex flex-col gap-1.5 sm:w-1/2 sm:pe-2">
            <FieldLabel htmlFor={dateId} label={t('trips.fields.tripDate')} />
            <input
              id={dateId}
              type="date"
              className="input"
              value={tripDate}
              onChange={(e) => setTripDate(e.target.value)}
            />
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4 border-t border-stone-200 pt-5">
          <legend className="mb-3 text-sm font-semibold text-stone-800">
            {t('trips.form.cargoSection')}
          </legend>
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label={t('trips.fields.cargoType')}
              placeholder={t('trips.fields.cargoTypePlaceholder')}
              value={cargoType}
              options={allowedRates.map((r) => ({
                value: r.cargoType,
                label: t(`cargoTypes.${r.cargoType}`)
              }))}
              onChange={(e) => setCargoType(e.target.value as CargoType)}
            />
            <NumberField
              label={t('trips.fields.quantity')}
              value={quantity}
              allowDecimal
              maxDigits={7}
              invalid={overCapacity}
              suffix={unit ? t(`units.name.${unit}`) : undefined}
              hint={overCapacity ? t('fleet.errors.over_capacity') : undefined}
              onValueChange={setQuantity}
            />
          </div>
        </fieldset>

        <div className="flex justify-end gap-2 border-t border-stone-200 pt-5">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <SubmitButton pending={pending} className="" label={t('trips.form.submit')} />
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
          <SummaryRow label={t('trips.tax.rate')}>
            {rate
              ? t(
                  `trips.tax.${rate.perQuantity === 1 ? 'rateValuePerOne' : 'rateValue'}.${rate.unit}`,
                  {
                    rate: format.currency(rate.ratePerKm),
                    per: format.number(rate.perQuantity)
                  }
                )
              : '—'}
          </SummaryRow>
          <SummaryRow label={t('trips.tax.quantity')}>
            {rate && quantityValue > 0 ? format.quantity(quantityValue, rate.unit) : '—'}
          </SummaryRow>
        </dl>

        <div className="rounded-lg border border-brand-200 bg-brand-50 p-4">
          <div className="text-xs font-medium text-brand-800">{t('trips.tax.total')}</div>
          <div className="mt-1 text-2xl font-semibold text-brand-900 tabular-nums">
            {tax !== null ? format.currency(tax) : '—'}
          </div>
          {tax !== null && rate && distanceKm !== null && (
            <div className="mt-2 text-xs text-brand-800 tabular-nums">
              {t(rate.perQuantity === 1 ? 'trips.tax.formula' : 'trips.tax.formulaPer', {
                rate: format.number(rate.ratePerKm),
                distance: format.number(distanceKm),
                quantity: format.number(quantityValue),
                per: format.number(rate.perQuantity)
              })}
            </div>
          )}
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
