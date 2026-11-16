import { useId, useState, type InputHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, Eye, EyeOff, LoaderCircle } from 'lucide-react'
import type { AuthErrorCode } from '../../../../shared/auth'

// Errors the forms can show: everything the backend returns plus client-side checks
export type AuthFormError = AuthErrorCode | 'password_mismatch'

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  hint?: string
  optional?: boolean
}

function FieldLabel({
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

export function TextField({ label, hint, optional, ...inputProps }: FieldProps): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={id} label={label} optional={optional} />
      <input id={id} className="input" {...inputProps} />
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

export function FormError({ code }: { code: AuthFormError }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="alert-error" role="alert">
      <CircleAlert size={16} className="mt-0.5 shrink-0" />
      <span>{t(`auth.errors.${code}`)}</span>
    </div>
  )
}

export function SubmitButton({
  pending,
  label
}: {
  pending: boolean
  label: string
}): React.JSX.Element {
  return (
    <button type="submit" className="btn btn-primary w-full" disabled={pending}>
      {pending && <LoaderCircle size={16} className="animate-spin" />}
      {label}
    </button>
  )
}
