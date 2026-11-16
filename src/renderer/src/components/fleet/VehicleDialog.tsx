import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Truck } from 'lucide-react'
import {
  QUANTITY_UNITS,
  VEHICLE_TYPES,
  defaultUnitFor,
  type FleetErrorCode,
  type QuantityUnit,
  type VehicleRecord,
  type VehicleType
} from '../../../../shared/fleet'
import { parsePlate } from '../../../../shared/plate'
import { FormAlert, NumberField, SelectField, SubmitButton } from '../form/fields'
import Modal from '../ui/Modal'
import { plateValueToString, type PlateValue } from '../../lib/plateValue'
import PlateInput from './PlateInput'

interface VehicleDialogProps {
  // Editing an existing vehicle, or adding a new one when omitted
  vehicle?: VehicleRecord
  onClose: () => void
  onSaved: (vehicle: VehicleRecord) => void
}

function initialPlate(vehicle?: VehicleRecord): PlateValue {
  const parts = vehicle && parsePlate(vehicle.plateNumber)
  return parts ? { code: parts.code, number: String(parts.number) } : { code: '', number: '' }
}

function VehicleDialog({ vehicle, onClose, onSaved }: VehicleDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const [plate, setPlate] = useState<PlateValue>(() => initialPlate(vehicle))
  const [vehicleType, setVehicleType] = useState<VehicleType | ''>(vehicle?.vehicleType ?? '')
  const [capacity, setCapacity] = useState(vehicle ? String(vehicle.capacity) : '')
  const [unit, setUnit] = useState<QuantityUnit>(vehicle?.capacityUnit ?? 'ton')
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [pending, setPending] = useState(false)

  // Picking a type suggests its usual unit; the owner can still change it afterwards
  const handleTypeChange = (type: VehicleType): void => {
    setVehicleType(type)
    setUnit(defaultUnitFor(type))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    const plateNumber = plateValueToString(plate)
    if (!plateNumber || !vehicleType || capacity === '') {
      setError('missing_fields')
      return
    }
    const capacityValue = Number(capacity)
    if (!(capacityValue > 0)) {
      setError('invalid_capacity')
      return
    }

    const input = { plateNumber, vehicleType, capacity: capacityValue, capacityUnit: unit }
    setError(null)
    setPending(true)
    try {
      const result = vehicle
        ? await window.api.fleet.updateVehicle(vehicle.id, input)
        : await window.api.fleet.addVehicle(input)
      if (result.ok) onSaved(result.data)
      else setError(result.error)
    } catch {
      setError('unknown')
    } finally {
      setPending(false)
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
