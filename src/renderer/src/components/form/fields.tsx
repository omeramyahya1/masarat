import {
  useId,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
  type SelectHTMLAttributes
} from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, CircleCheck, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { toArabicDigits, toWesternDigits } from '../../lib/format'

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  hint?: string
  optional?: boolean
  // Latin-only values (usernames, phone numbers): typed left-to-right, but still aligned with
  // the rest of the form in Arabic
  ltr?: boolean
}

export function FieldLabel({
  htmlFor,
  label,
  optional
}: {
  htmlFor: string
  label: string
  optional?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <label htmlFor={htmlFor} className="label">
      {label}
      {optional && (
        <span className="ms-1 font-normal text-stone-400">{t('auth.fields.optional')}</span>
      )}
    </label>
  )
}

export function TextField({
  label,
  hint,
  optional,
  ltr,
  ...inputProps
}: FieldProps): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id} label={label} optional={optional} />
      <input
        id={id}
        className={ltr ? 'input rtl:text-right' : 'input'}
        dir={ltr ? 'ltr' : undefined}
        {...inputProps}
      />
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

export function PasswordField({ label, hint, ...inputProps }: FieldProps): React.JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const [visible, setVisible] = useState(false)
  const Icon = visible ? EyeOff : Eye

  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id} label={label} />
      <div className="relative">
        <input
          id={id}
          className="input pe-10"
          type={visible ? 'text' : 'password'}
          {...inputProps}
        />
        <button
          type="button"
          className="absolute inset-y-0 end-0 flex w-10 items-center justify-center text-stone-400 hover:text-stone-700"
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          onClick={() => setVisible((v) => !v)}
        >
          <Icon size={18} />
        </button>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

interface NumberFieldProps {
  label?: string
  hint?: string
  invalid?: boolean
  // Western digits ("12.5"); shown with Arabic digits while the UI is in Arabic
  value: string
  onValueChange: (value: string) => void
  allowDecimal?: boolean
  maxDigits?: number
  // Unit shown inside the input's end edge (e.g. "tons")
  suffix?: string
  id?: string
  ariaLabel?: string
  placeholder?: string
  autoFocus?: boolean
}

export function NumberField({
  label,
  hint,
  invalid,
  value,
  onValueChange,
  allowDecimal,
  maxDigits,
  suffix,
  id: idProp,
  ariaLabel,
  placeholder,
  autoFocus
}: NumberFieldProps): React.JSX.Element {
  const { i18n } = useTranslation()
  const generatedId = useId()
  const id = idProp ?? generatedId
  const isArabic = i18n.language === 'ar'
  const pattern = allowDecimal ? /^\d*\.?\d{0,2}$/ : /^\d*$/

  const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const next = toWesternDigits(e.target.value.trim())
    if (!pattern.test(next)) return
    if (maxDigits && next.replace('.', '').length > maxDigits) return
    onValueChange(next)
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && <FieldLabel htmlFor={id} label={label} />}
      <div className="relative">
        <input
          id={id}
          className={`input tabular-nums ${suffix ? 'pe-14' : ''} ${invalid ? 'input-invalid' : ''}`}
          inputMode={allowDecimal ? 'decimal' : 'numeric'}
          autoComplete="off"
          aria-label={ariaLabel}
          aria-invalid={invalid || undefined}
          value={isArabic ? toArabicDigits(value) : value}
          placeholder={placeholder}
          autoFocus={autoFocus}
          onChange={handleChange}
        />
        {suffix && (
          <span className="pointer-events-none absolute inset-y-0 end-0 flex items-center pe-3 text-sm text-stone-500">
            {suffix}
          </span>
        )}
      </div>
      {hint && <p className={invalid ? 'field-hint text-red-700' : 'field-hint'}>{hint}</p>}
    </div>
  )
}

export interface SelectOption {
  value: string
  label: string
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  label: string
  hint?: string
  options: SelectOption[]
  // Shown as a disabled first option while nothing is selected
  placeholder?: string
}

export function SelectField({
  label,
  hint,
  options,
  placeholder,
  value,
  ...selectProps
}: SelectFieldProps): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id} label={label} />
      <select id={id} className="input" value={value} {...selectProps}>
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  )
}

export function FormAlert({
  message,
  tone = 'error'
}: {
  message: string
  tone?: 'error' | 'success'
}): React.JSX.Element {
  const Icon = tone === 'error' ? CircleAlert : CircleCheck
  return (
    <div className={tone === 'error' ? 'alert-error' : 'alert-success'} role="alert">
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

export function SubmitButton({
  pending,
  label,
  className = 'w-full'
}: {
  pending: boolean
  label: string
  className?: string
}): React.JSX.Element {
  return (
    <button type="submit" className={`btn btn-primary ${className}`} disabled={pending}>
      {pending && <LoaderCircle size={16} className="animate-spin" />}
      {label}
    </button>
  )
}
