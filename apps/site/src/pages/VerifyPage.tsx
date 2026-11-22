import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleAlert, CircleCheckBig, Clock, LoaderCircle } from 'lucide-react'
import type { ManifestVerification } from '@masarat/shared/billing'
import type { FleetErrorCode } from '@masarat/shared/fleet'
import { useFormat } from '@masarat/ui/lib/format'
import PlateBadge from '@masarat/ui/components/fleet/PlateBadge'
import { api } from '@masarat/api-client'

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-stone-100 py-2.5 last:border-0">
      <dt className="text-sm text-stone-500">{label}</dt>
      <dd className="text-end text-sm font-medium text-stone-900">{children}</dd>
    </div>
  )
}

// What a manifest's QR code opens: whether it's valid, and the details an officer compares with
// the printed copy. Public: no sign-in, and nothing personal is shown.
function VerifyPage({ token }: { token: string }): React.JSX.Element {
  const { t } = useTranslation()
  const format = useFormat()
  const [result, setResult] = useState<ManifestVerification | null>(null)
  const [error, setError] = useState<FleetErrorCode | 'too_many_attempts' | null>(null)

  useEffect(() => {
    api.verify
      .get(token)
      .then((response) => (response.ok ? setResult(response.data) : setError(response.error)))
      .catch(() => setError('unknown'))
  }, [token])

  if (!result && !error) {
    return (
      <div
        className="flex flex-1 items-center justify-center"
        role="status"
        aria-label={t('shell.loading')}
      >
        <LoaderCircle size={28} className="animate-spin text-brand-700" />
      </div>
    )
  }

  if (!result) {
    const notFound = error === 'manifest_not_found'
    return (
      <div className="flex flex-1 items-start justify-center px-4 py-10 sm:px-6">
        <div className="card w-full max-w-md p-6 text-center sm:p-8">
          <CircleAlert size={40} className="mx-auto mb-3 text-red-600" />
          <h1 className="text-lg font-semibold text-stone-900">
            {t(notFound ? 'site.verify.notFound.title' : 'site.verify.failed.title')}
          </h1>
          <p className="mt-2 text-sm text-stone-600">
            {notFound
              ? t('site.verify.notFound.body')
              : error === 'too_many_attempts'
                ? t('auth.errors.too_many_attempts')
                : t('site.verify.failed.body')}
          </p>
        </div>
      </div>
    )
  }

  const valid = result.status === 'valid'
  return (
    <div className="flex flex-1 items-start justify-center px-4 py-10 sm:px-6">
      <div className="card w-full max-w-md overflow-hidden">
        <div
          className={`flex flex-col items-center gap-2 px-6 py-6 text-center ${
            valid ? 'bg-brand-50 text-brand-800' : 'bg-amber-50 text-amber-800'
          }`}
        >
          {valid ? <CircleCheckBig size={44} /> : <Clock size={44} />}
          <h1 className="text-xl font-bold">
            {t(valid ? 'site.verify.valid' : 'site.verify.expired')}
          </h1>
          <p className="text-sm">
            {t(valid ? 'site.verify.validUntil' : 'site.verify.expiredOn', {
              date: format.date(result.validUntil)
            })}
          </p>
        </div>
        <dl className="px-6 py-4">
          <Row label={t('site.verify.fields.manifestNo')}>
            <span dir="ltr" className="font-mono">
              {result.manifestNo}
            </span>
          </Row>
          <Row label={t('site.verify.fields.receiptNo')}>
            <span dir="ltr" className="font-mono">
              {result.certificateNo}
            </span>
          </Row>
          <Row label={t('site.verify.fields.plate')}>
            <PlateBadge plate={result.plateNumber} />
          </Row>
          <Row label={t('site.verify.fields.tripKind')}>{t(`tripKinds.${result.tripKind}`)}</Row>
          <Row label={t('site.verify.fields.route')}>
            {format.city(result.origin)} {format.isArabic ? '←' : '→'}{' '}
            {format.city(result.destination)}
          </Row>
          <Row label={t('site.verify.fields.tripDate')}>{format.date(result.tripDate)}</Row>
          <Row label={t('site.verify.fields.carrier')}>
            <bdi>{result.carrierName}</bdi>
          </Row>
          <Row label={t('site.verify.fields.amountPaid')}>
            <span className="tabular-nums">{format.currency(result.amountPaid)}</span>
          </Row>
          <Row label={t('site.verify.fields.issuedAt')}>{format.date(result.issuedAt)}</Row>
        </dl>
        <p className="border-t border-stone-200 px-6 py-4 text-xs text-stone-500">
          {t('site.verify.note', { time: format.dateTime(result.checkedAt) })}
        </p>
      </div>
    </div>
  )
}

export default VerifyPage
