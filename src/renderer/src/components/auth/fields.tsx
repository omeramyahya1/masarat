import { useTranslation } from 'react-i18next'
import type { AuthErrorCode } from '../../../../shared/auth'
import { FormAlert } from '../form/fields'

export { PasswordField, SubmitButton, TextField } from '../form/fields'

// Errors the forms can show: everything the backend returns plus client-side checks
export type AuthFormError = AuthErrorCode | 'password_mismatch'

export function FormError({ code }: { code: AuthFormError }): React.JSX.Element {
  const { t } = useTranslation()
  return <FormAlert message={t(`auth.errors.${code}`)} />
}
