import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Truck } from 'lucide-react'
import {
  MAX_REGISTRATION_LENGTH,
  QUANTITY_UNITS,
  VEHICLE_TYPES,
  defaultUnitFor,
  type FleetErrorCode,
  type QuantityUnit,
  type VehicleRecord,
  type VehicleType
} from '@masarat/shared/fleet'
import { parsePlate } from '@masarat/shared/plate'
import {
  FormAlert,
  NumberField,
  SelectField,
  SubmitButton,
  TextField
} from '@masarat/ui/components/form/fields'
import Modal from '@masarat/ui/components/ui/Modal'
import { plateValueToString, type PlateValue } from '@masarat/ui/lib/plateValue'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import PlateInput from './PlateInput'
import { api } from '@masarat/api-client'

interface VehicleDialogProps {
  // Editing an existing vehicle, or adding a new one when omitted
  vehicle?: VehicleRecord
  onClose: () => void
  onSaved: (vehicle: VehicleRecord) => void
}

function initialPlate(vehicle?: VehicleRecord): PlateValue {
  const parts = vehicle && parsePlate(vehicle.plateNumber)
  return parts
    ? { code: parts.code, series: String(parts.series), number: String(parts.number) }
    : { code: '', series: '', number: '' }
}

function VehicleDialog({ vehicle, onClose, onSaved }: VehicleDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const [plate, setPlate] = useState<PlateValue>(() => initialPlate(vehicle))
  const [registrationNo, setRegistrationNo] = useState(vehicle?.registrationNo ?? '')
  const [vehicleType, setVehicleType] = useState<VehicleType | ''>(vehicle?.vehicleType ?? '')
  const [capacity, setCapacity] = useState(vehicle ? String(vehicle.capacity) : '')
  const [unit, setUnit] = useState<QuantityUnit>(vehicle?.capacityUnit ?? 'ton')
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [pending, setPending] = useState(false)
  const mounted = useMountedRef()
  // Trips record cargo in the vehicle's unit, so it can't change once the vehicle has trips
  const unitLocked = Boolean(vehicle && vehicle.tripCount > 0)

  // Picking a type suggests its usual unit; the owner can still change it afterwards
  const handleTypeChange = (type: VehicleType): void => {
    setVehicleType(type)
    if (!unitLocked) setUnit(defaultUnitFor(type))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const plateNumber = plateValueToString(plate)
    if (!plateNumber || !registrationNo.trim() || !vehicleType || capacity === '') {
      setError('missing_fields')
      return
    }
    const capacityValue = Number(capacity)
    if (!(capacityValue > 0)) {
      setError('invalid_capacity')
      return
    }

    const input = {
      plateNumber,
      registrationNo: registrationNo.trim(),
      vehicleType,
      capacity: capacityValue,
      capacityUnit: unit
    }
    setError(null)
    setPending(true)
    try {
      const result = vehicle
        ? await api.fleet.updateVehicle(vehicle.id, input)
        : await api.fleet.addVehicle(input)
      // The dialog may have been closed (and another opened) while the request was in flight
      if (!mounted.current) return
      if (result.ok) onSaved(result.data)
      else setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  return (
    <Modal labelledBy={titleId} onClose={onClose} className="max-w-lg">
      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <Truck size={20} />
          </div>
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              {vehicle ? t('fleet.dialog.editTitle') : t('fleet.dialog.addTitle')}
            </h2>
            <p className="text-sm text-stone-500">{t('fleet.dialog.subtitle')}</p>
          </div>
        </div>

        {error && <FormAlert message={t(`fleet.errors.${error}`)} />}

        <PlateInput value={plate} onChange={setPlate} />

        <TextField
          label={t('fleet.fields.registrationNo')}
          hint={t('fleet.fields.registrationNoHint')}
          value={registrationNo}
          maxLength={MAX_REGISTRATION_LENGTH}
          autoComplete="off"
          ltr
          onChange={(e) => setRegistrationNo(e.target.value)}
        />

        <SelectField
          label={t('fleet.fields.vehicleType')}
          placeholder={t('fleet.fields.vehicleTypePlaceholder')}
          value={vehicleType}
          options={VEHICLE_TYPES.map((type) => ({ value: type, label: t(`vehicleTypes.${type}`) }))}
          onChange={(e) => handleTypeChange(e.target.value as VehicleType)}
        />

        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-2">
          <NumberField
            label={t('fleet.fields.capacity')}
            value={capacity}
            allowDecimal
            maxDigits={7}
            placeholder={t(`fleet.fields.capacityPlaceholder.${unit}`)}
            onValueChange={setCapacity}
          />
          <SelectField
            label={t('fleet.fields.capacityUnit')}
            value={unit}
            disabled={unitLocked}
            title={unitLocked ? t('fleet.errors.unit_in_use') : undefined}
            options={QUANTITY_UNITS.map((u) => ({ value: u, label: t(`units.name.${u}`) }))}
            onChange={(e) => setUnit(e.target.value as QuantityUnit)}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-stone-200 pt-4">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <SubmitButton
            pending={pending}
            className=""
            label={vehicle ? t('fleet.dialog.save') : t('fleet.dialog.add')}
          />
        </div>
      </form>
    </Modal>
  )
}

export default VehicleDialog
