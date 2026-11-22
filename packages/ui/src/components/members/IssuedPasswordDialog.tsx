import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import type { IssuedPassword } from '@masarat/shared/govtUsers'
import Modal from '@masarat/ui/components/ui/Modal'

// Shows a new temporary password once, for the admin to pass on to the user
function IssuedPasswordDialog({
  issued,
  reset,
  onClose
}: {
  issued: IssuedPassword
  // A password reset rather than a new account
  reset: boolean
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const titleId = useId()
  const [copied, setCopied] = useState(false)

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(issued.temporaryPassword)
      setCopied(true)
    } catch {
      // Clipboard unavailable: the password can still be selected and copied by hand
    }
  }

  return (
    <Modal labelledBy={titleId} onClose={onClose}>
      <h2 id={titleId} className="mb-2 text-lg font-semibold">
        {t(reset ? 'govt.users.issued.resetTitle' : 'govt.users.issued.createdTitle')}
      </h2>
      <p className="mb-4 text-sm text-stone-600">
        {t('govt.users.issued.body', { name: issued.user.fullName })}
      </p>
      <dl className="mb-6 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm">
        <dt className="text-stone-500">{t('govt.users.issued.username')}</dt>
        <dd dir="ltr" className="font-mono text-stone-900 select-text">
          {issued.user.username}
        </dd>
        <dt className="text-stone-500">{t('govt.users.issued.password')}</dt>
        <dd className="flex items-center justify-between gap-2">
          <span dir="ltr" className="font-mono text-base font-semibold tracking-wider select-all">
            {issued.temporaryPassword}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {t(copied ? 'govt.users.issued.copied' : 'govt.users.issued.copy')}
          </button>
        </dd>
      </dl>
      <div className="flex justify-end">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('govt.users.issued.done')}
        </button>
      </div>
    </Modal>
  )
}

export default IssuedPasswordDialog
