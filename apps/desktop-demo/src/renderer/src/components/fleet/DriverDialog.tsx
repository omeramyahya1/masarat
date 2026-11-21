import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { UserRound } from 'lucide-react'
import {
  MAX_DRIVER_NAME_LENGTH,
  type DriverRecord,
  type FleetErrorCode
} from '../../../../shared/fleet'
import { FormAlert, SubmitButton, TextField } from '../form/fields'
import Modal from '../ui/Modal'
import { useMountedRef } from '../../lib/useMountedRef'

interface DriverDialogProps {
  // Editing an existing driver, or adding a new one when omitted
  driver?: DriverRecord
  onClose: () => void
  onSaved: (driver: DriverRecord) => void
}

function DriverDialog({ driver, onClose, onSaved }: DriverDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const [name, setName] = useState(driver?.name ?? '')
  const [phone, setPhone] = useState(driver?.phone ?? '')
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [pending, setPending] = useState(false)
  const mounted = useMountedRef()

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    // The trip form opens this dialog through a portal, and React still bubbles events through
    // portals: without this the trip form would submit (and save the trip) too
    event.stopPropagation()
    if (!name.trim() || !phone.trim()) {
      setError('missing_fields')
      return
    }

    const input = { name: name.trim(), phone: phone.trim() }
    setError(null)
    setPending(true)
    try {
      const result = driver
        ? await window.api.fleet.updateDriver(driver.id, input)
        : await window.api.fleet.addDriver(input)
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
    <Modal labelledBy={titleId} onClose={onClose} className="max-w-md">
      <form className="flex flex-col gap-5" onSubmit={handleSubmit} noValidate>
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
            <UserRound size={20} />
          </div>
          <div>
            <h2 id={titleId} className="text-base font-semibold">
              {driver ? t('drivers.dialog.editTitle') : t('drivers.dialog.addTitle')}
            </h2>
            <p className="text-sm text-stone-500">{t('drivers.dialog.subtitle')}</p>
          </div>
        </div>

        {error && <FormAlert message={t(`fleet.errors.${error}`)} />}

        <TextField
          label={t('drivers.fields.name')}
          value={name}
          maxLength={MAX_DRIVER_NAME_LENGTH}
          autoComplete="off"
          autoFocus
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          label={t('drivers.fields.phone')}
          hint={t('drivers.fields.phoneHint')}
          type="tel"
          value={phone}
          maxLength={20}
          autoComplete="off"
          ltr
          onChange={(e) => setPhone(e.target.value)}
        />

        <div className="flex justify-end gap-2 border-t border-stone-200 pt-4">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <SubmitButton
            pending={pending}
            className=""
            label={driver ? t('drivers.dialog.save') : t('drivers.dialog.add')}
          />
        </div>
      </form>
    </Modal>
  )
}

export default DriverDialog
