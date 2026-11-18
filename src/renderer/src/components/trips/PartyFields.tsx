import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MAX_PARTY_ADDRESS_LENGTH,
  MAX_PARTY_NAME_LENGTH,
  type Party
} from '../../../../shared/fleet'
import { TextField } from '../form/fields'

interface PartyFieldsProps {
  legend: string
  value: Party
  // Senders and receivers from earlier trips; picking a name fills in its address and phone
  suggestions: readonly Party[]
  // Filled in from a scanned document and not edited since
  highlighted?: boolean
  onChange: (value: Party) => void
}

// Name, address and phone of the trip's sender or receiver
function PartyFields({
  legend,
  value,
  suggestions,
  highlighted,
  onChange
}: PartyFieldsProps): React.JSX.Element {
  const { t } = useTranslation()
  const listId = useId()

  const handleNameChange = (name: string): void => {
    const known = suggestions.find((party) => party.name === name)
    onChange(known ? { ...known } : { ...value, name })
  }

  return (
    <fieldset
      className={`flex flex-col gap-3 rounded-lg ${highlighted ? 'bg-amber-50/70 p-3 ring-2 ring-amber-300' : ''}`}
    >
      <legend className="mb-2 text-sm font-medium text-stone-700">{legend}</legend>
      <datalist id={listId}>
        {suggestions.map((party) => (
          <option key={`${party.name}|${party.address}|${party.phone}`} value={party.name}>
            {party.address}
          </option>
        ))}
      </datalist>
      <TextField
        label={t('trips.party.name')}
        list={listId}
        dir="auto"
        autoComplete="off"
        maxLength={MAX_PARTY_NAME_LENGTH}
        value={value.name}
        onChange={(e) => handleNameChange(e.target.value)}
      />
      <TextField
        label={t('trips.party.address')}
        dir="auto"
        autoComplete="off"
        maxLength={MAX_PARTY_ADDRESS_LENGTH}
        value={value.address}
        onChange={(e) => onChange({ ...value, address: e.target.value })}
      />
      <TextField
        label={t('trips.party.phone')}
        type="tel"
        autoComplete="off"
        maxLength={20}
        ltr
        value={value.phone}
        onChange={(e) => onChange({ ...value, phone: e.target.value })}
      />
    </fieldset>
  )
}

export default PartyFields
