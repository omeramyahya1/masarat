import { useId, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { MAX_PARTY_ADDRESS_LENGTH, MAX_PARTY_NAME_LENGTH, type Party } from '@masarat/shared/fleet'
import { TextField } from '@masarat/ui/components/form/fields'

interface PartyFieldsProps {
  legend: string
  value: Party
  // Senders and receivers from earlier trips; picking a name fills in its address and phone
  suggestions: readonly Party[]
  onChange: (value: Party) => void
}

// Name, address and phone of the trip's sender or receiver
function PartyFields({
  legend,
  value,
  suggestions,
  onChange
}: PartyFieldsProps): React.JSX.Element {
  const { t } = useTranslation()
  const listId = useId()

  // Picking a suggestion from the list fills in its address and phone; typing a name that
  // happens to match one (on the way to a longer name) only changes the name
  const handleNameChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const name = event.target.value
    // Chromium reports a picked suggestion as insertReplacementText (or, in some versions, an
    // input event without a type); typing always has one (insertText, deleteContentBackward, …)
    const { inputType } = event.nativeEvent as InputEvent
    const picked = !inputType || inputType === 'insertReplacementText'
    const known = picked ? suggestions.find((party) => party.name === name) : undefined
    onChange(known ? { ...known } : { ...value, name })
  }

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-stone-700">{legend}</legend>
      <div className="flex flex-col gap-3 rounded-lg">
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
          onChange={handleNameChange}
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
      </div>
    </fieldset>
  )
}

export default PartyFields
