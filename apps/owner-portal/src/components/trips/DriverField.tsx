import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { UserPlus } from 'lucide-react'
import type { DriverRecord } from '@masarat/shared/fleet'
import { formatSudanPhone } from '@masarat/shared/phone'
import { SelectField } from '@masarat/ui/components/form/fields'
import DriverDialog from '../fleet/DriverDialog'

// Picks one of the owner's drivers, or adds a new one without leaving the trip form
function DriverField({
  drivers,
  value,
  onChange,
  onAdded
}: {
  drivers: readonly DriverRecord[]
  // Driver id as a string, '' when none is picked
  value: string
  onChange: (value: string) => void
  onAdded: (driver: DriverRecord) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [adding, setAdding] = useState(false)

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
      <SelectField
        label={t('trips.fields.driver')}
        placeholder={t(
          drivers.length > 0 ? 'trips.fields.driverPlaceholder' : 'trips.fields.noDrivers'
        )}
        value={value}
        options={drivers.map((d) => ({
          value: String(d.id),
          // Options can't hold <bdi>: isolate the number (LRI … PDI) so its spaced groups keep
          // their order in Arabic
          label: `${d.name} · \u2066${formatSudanPhone(d.phone)}\u2069`
        }))}
        onChange={(e) => onChange(e.target.value)}
      />
      <button type="button" className="btn btn-secondary" onClick={() => setAdding(true)}>
        <UserPlus size={16} />
        {t('trips.fields.newDriver')}
      </button>
      {/* Portaled out of the trip form: a <form> nested in another is submitted natively by the
          browser (reloading the app) instead of reaching React */}
      {adding &&
        createPortal(
          <DriverDialog
            onClose={() => setAdding(false)}
            onSaved={(driver) => {
              setAdding(false)
              onAdded(driver)
            }}
          />,
          document.body
        )}
    </div>
  )
}

export default DriverField
