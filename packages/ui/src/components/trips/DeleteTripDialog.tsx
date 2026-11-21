import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, LoaderCircle, Trash2 } from 'lucide-react'
import type { FleetErrorCode, TripRecord, TripReferenceData } from '@masarat/shared/fleet'
import { useFormat } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FormAlert } from '../form/fields'
import PlateBadge from '../fleet/PlateBadge'
import Modal from '../ui/Modal'
import { api } from '@masarat/api-client'

// Confirms deleting a draft trip; drafts have no bill or certificate, so nothing else refers to it
function DeleteTripDialog({
  trip,
  reference,
  onClose,
  onDeleted
}: {
  trip: TripRecord
  reference: TripReferenceData
  onClose: () => void
  onDeleted: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const titleId = useId()
  const mounted = useMountedRef()
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [pending, setPending] = useState(false)
  const city = (id: number): string => format.city(reference.cities.find((c) => c.id === id))

  const handleDelete = async (): Promise<void> => {
    setPending(true)
    setError(null)
    try {
      const result = await api.trips.delete(trip.id)
      if (result.ok) return onDeleted()
      if (mounted.current) setError(result.error)
    } catch {
      if (mounted.current) setError('unknown')
    }
    if (mounted.current) setPending(false)
  }

  return (
    <Modal labelledBy={titleId} onClose={() => !pending && onClose()} className="max-w-sm">
      <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-red-50 text-red-700">
        <Trash2 size={20} />
      </div>
      <h2 id={titleId} className="text-base font-semibold">
        {t('trips.deleteDialog.title', { id: format.number(trip.id) })}
      </h2>
      <div className="mt-2 flex flex-col gap-3 text-sm text-stone-600">
        <div className="flex flex-wrap items-center gap-3">
          <PlateBadge plate={trip.plateNumber} />
          <span className="inline-flex items-center gap-1.5 text-stone-800">
            {city(trip.originCityId)}
            <ArrowRight size={14} className="text-stone-400 rtl:-scale-x-100" />
            {city(trip.destinationCityId)}
          </span>
        </div>
        <p>{t('trips.deleteDialog.body')}</p>
        {error && <FormAlert message={t(`fleet.errors.${error}`)} />}
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={pending}
          onClick={onClose}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={pending}
          onClick={handleDelete}
        >
          {pending && <LoaderCircle size={16} className="animate-spin" />}
          {t('trips.deleteDialog.confirm')}
        </button>
      </div>
    </Modal>
  )
}

export default DeleteTripDialog
