import { useTranslation } from 'react-i18next'
import { CheckCircle2, FileCheck2, QrCode } from 'lucide-react'
import { BrandLockup } from '@masarat/ui/components/BrandMark'
import { PANEL_ICONS } from '@masarat/ui/panels'
import type { UserKind } from '@masarat/shared/permissions'
import type { Page } from '../router'
import Link from '../components/Link'

const AUDIENCES: { kind: UserKind; key: 'owners' | 'govt' }[] = [
  { kind: 'company', key: 'owners' },
  { kind: 'govt', key: 'govt' }
]
const POINTS = ['p1', 'p2', 'p3', 'p4'] as const
const STEPS = ['s1', 's2', 's3'] as const

// Bar widths (%) for the preview's skeleton: the trip lines, the parties' label / value pairs and
// the cargo rows
const TRIP_LINES = [80, 64, 72]
const PARTIES = [
  [40, 70],
  [32, 60],
  [44, 76],
  [36, 52]
]
const CARGO_ROWS = [
  [70, 30, 20],
  [56, 36, 24],
  [64, 28, 18]
]

// A small stand-in for the authorized manifest, next to the hero text. It fills the hero's
// height: the header at the top, the QR footer at the bottom, the body spread between them.
function ManifestPreview(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div aria-hidden className="card mx-auto flex h-full w-full max-w-sm flex-col p-5 shadow-lg">
      <div className="flex items-center justify-between border-b border-stone-200 pb-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-brand-800">
          <FileCheck2 size={18} />
          {t('statuses.certified')}
        </div>
        <span dir="ltr" className="font-mono text-[11px] text-stone-500">
          MNF-2026-000128
        </span>
      </div>

      <div className="flex flex-1 flex-col justify-around gap-5 py-5">
        <div className="space-y-2">
          {TRIP_LINES.map((width, i) => (
            <div key={i} className="h-2 rounded bg-stone-100" style={{ width: `${width}%` }} />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-stone-200 bg-stone-200">
          {PARTIES.map(([label, value], i) => (
            <div key={i} className="space-y-1.5 bg-white p-2.5">
              <div className="h-1.5 rounded bg-stone-200" style={{ width: `${label}%` }} />
              <div className="h-2 rounded bg-stone-100" style={{ width: `${value}%` }} />
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-md border border-stone-200">
          <div className="flex gap-3 bg-stone-50 px-2.5 py-2">
            <div className="h-1.5 flex-[3] rounded bg-stone-200" />
            <div className="h-1.5 flex-[2] rounded bg-stone-200" />
            <div className="h-1.5 flex-1 rounded bg-stone-200" />
          </div>
          {CARGO_ROWS.map((row, i) => (
            <div key={i} className="flex gap-3 border-t border-stone-100 px-2.5 py-2">
              {row.map((width, j) => (
                <div key={j} className={j === 0 ? 'flex-[3]' : j === 1 ? 'flex-[2]' : 'flex-1'}>
                  <div className="h-2 rounded bg-stone-100" style={{ width: `${width + 30}%` }} />
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-end justify-between border-t border-stone-200 pt-4">
        <div className="space-y-2">
          <div className="h-2 w-24 rounded bg-brand-100" />
          <div className="h-2 w-16 rounded bg-brand-100" />
        </div>
        <QrCode size={56} strokeWidth={1.25} className="text-stone-800" />
      </div>
    </div>
  )
}

function LandingPage({ navigate }: { navigate: (page: Page) => void }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <section className="bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 sm:px-6 md:grid-cols-[3fr_2fr] md:py-20">
          <div>
            <BrandLockup className="mb-8 h-14 w-auto sm:h-16" />
            <p className="mb-3 inline-flex rounded-full bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800">
              {t('site.hero.eyebrow')}
            </p>
            <h1 className="mb-4 text-3xl leading-tight font-bold text-stone-900 sm:text-4xl">
              {t('site.hero.title')}
            </h1>
            <p className="mb-8 max-w-2xl text-base text-stone-600">{t('site.hero.subtitle')}</p>
            <div className="flex flex-wrap gap-3">
              <Link to="login" navigate={navigate} className="btn btn-primary">
                {t('site.hero.login')}
              </Link>
              <Link to="signup" navigate={navigate} className="btn btn-secondary">
                {t('site.hero.signup')}
              </Link>
            </div>
          </div>
          <ManifestPreview />
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:px-6 md:grid-cols-2">
        {AUDIENCES.map(({ kind, key }) => {
          const Icon = PANEL_ICONS[kind]
          return (
            <article key={key} className="card p-6">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex size-11 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                  <Icon size={22} strokeWidth={1.75} />
                </span>
                <h2 className="text-lg font-semibold text-stone-900">{t(`site.${key}.title`)}</h2>
              </div>
              <ul className="space-y-3">
                {POINTS.map((point) => (
                  <li key={point} className="flex gap-2 text-sm text-stone-700">
                    <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-brand-600" />
                    {t(`site.${key}.${point}`)}
                  </li>
                ))}
              </ul>
            </article>
          )
        })}
      </section>

      <section className="border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6">
          <h2 className="mb-8 text-2xl font-bold text-stone-900">{t('site.steps.title')}</h2>
          <ol className="grid gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step} className="flex gap-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold text-white tabular-nums">
                  {index + 1}
                </span>
                <div>
                  <h3 className="mb-1 font-semibold text-stone-900">
                    {t(`site.steps.${step}.title`)}
                  </h3>
                  <p className="text-sm text-stone-600">{t(`site.steps.${step}.body`)}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>
    </>
  )
}

export default LandingPage
