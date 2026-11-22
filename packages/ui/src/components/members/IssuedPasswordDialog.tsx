import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy } from 'lucide-react'
import type { IssuedPassword } from '@masarat/shared/members'
import Modal from '../ui/Modal'

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
        {t(reset ? 'members.issued.resetTitle' : 'members.issued.createdTitle')}
      </h2>
      <p className="mb-4 text-sm text-stone-600">
        {t('members.issued.body', { name: issued.user.fullName })}
      </p>
      <dl className="mb-6 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 rounded-lg border border-stone-200 bg-stone-50 p-4 text-sm">
        <dt className="text-stone-500">{t('members.issued.username')}</dt>
        <dd dir="ltr" className="font-mono text-stone-900 select-text">
          {issued.user.username}
        </dd>
        <dt className="text-stone-500">{t('members.issued.password')}</dt>
        <dd className="flex items-center justify-between gap-2">
          <span dir="ltr" className="font-mono text-base font-semibold tracking-wider select-all">
            {issued.temporaryPassword}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={copy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {t(copied ? 'members.issued.copied' : 'members.issued.copy')}
          </button>
        </dd>
      </dl>
      <div className="flex justify-end">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('members.issued.done')}
        </button>
      </div>
    </Modal>
  )
}

export default IssuedPasswordDialog
