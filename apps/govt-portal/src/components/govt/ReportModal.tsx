import { lazy, Suspense, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LoaderCircle, Printer } from 'lucide-react'
import { formatDay, type DashboardView } from '@masarat/shared/analytics'
import type { DashboardData } from '@masarat/shared/dashboard'
import type { CityRecord } from '@masarat/shared/fleet'
import { createFormatters } from '@masarat/ui/lib/format'
import { printDocument } from '@masarat/ui/lib/printDocument'
import Modal from '@masarat/ui/components/ui/Modal'
import { DocumentSheet, Field, Section } from '@masarat/ui/components/trips/documentParts'
import BarList from './BarList'
import { arrangeBreakdown, breakdownLabel } from './breakdownRows'
import type { ReportSection } from './reportSections'

const RevenueChart = lazy(() => import('./RevenueChart'))

// The chart's size on the sheet, in px (the sheet's content is 190 mm, about 718 px, wide)
const CHART_SIZE = { width: 660, height: 250 }

// Tells the modal the lazily loaded chart is on the page, so the PDF isn't taken without it
function Ready({ onReady }: { onReady: () => void }): null {
  useEffect(onReady, [onReady])
  return null
}

function Block({
  title,
  className = '',
  children
}: {
  title: string
  className?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className={`flex flex-col gap-2 ${className}`}>
      <h4 className="border-b border-brand-700 pb-1 text-[13px] font-bold text-brand-800">
        {title}
      </h4>
      {children}
    </section>
  )
}

// The dashboard as an official report: A4 sheets with the letterhead, always in Arabic, saved as
// a PDF. Page 1 has the parameters, the KPIs and the revenue chart; page 2 the breakdowns.
function ReportModal({
  data,
  view,
  sections,
  cities,
  onClose
}: {
  data: DashboardData
  view: DashboardView
  sections: ReadonlySet<ReportSection>
  cities: readonly CityRecord[]
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const titleId = useId()
  const ar = useMemo(() => i18n.getFixedT('ar'), [i18n])
  const fa = useMemo(() => createFormatters(true, ar), [ar])
  const [chartReady, setChartReady] = useState(!sections.has('chart'))
  const f = data.filters
  const { kpis } = data

  const all = ar('govt.filters.all')
  const city = (id?: number | null): string | null =>
    id ? fa.city(cities.find((c) => c.id === id)) : null
  const state = (name?: string | null): string | null =>
    name
      ? ar('govt.filters.wholeState', { state: fa.state(cities.find((c) => c.state === name)) })
      : null
  const period =
    f.range.preset === 'custom'
      ? ar('govt.filters.rangeLabel', { from: fa.date(data.from), to: fa.date(data.to - 1) })
      : `${ar(`govt.filters.presets.${f.range.preset}`)} (${ar('govt.filters.rangeLabel', {
          from: fa.date(data.from),
          to: fa.date(data.to)
        })})`
  const parameters: [string, string][] = [
    [ar('govt.filters.period'), period],
    [ar('govt.filters.origin'), city(f.originCityId) ?? state(f.originState) ?? all],
    [ar('govt.filters.destination'), city(f.destinationCityId) ?? state(f.destinationState) ?? all],
    [ar('govt.filters.cargoType'), f.cargoType ? ar(`cargoTypes.${f.cargoType}`) : all],
    [ar('govt.filters.vehicleType'), f.vehicleType ? ar(`vehicleTypes.${f.vehicleType}`) : all],
    [ar('govt.filters.tripKind'), f.tripKind ? ar(`tripKinds.${f.tripKind}`) : all],
    [ar('govt.dashboard.revenue.groupBy'), ar(`govt.dashboard.revenue.buckets.${data.bucket}`)]
  ]

  const change =
    kpis.previousRevenue && kpis.previousRevenue > 0
      ? (kpis.revenue - kpis.previousRevenue) / kpis.previousRevenue
      : null
  const kpiTiles: [string, string, string?][] = [
    [
      ar('govt.dashboard.kpis.revenue'),
      fa.currency(kpis.revenue),
      change === null
        ? undefined
        : `${change >= 0 ? '▲' : '▼'} ${fa.percent(Math.abs(change))} ${ar('govt.dashboard.kpis.vsPrevious')}`
    ],
    [
      ar('govt.dashboard.kpis.pendingBills'),
      fa.number(kpis.pendingBills),
      ar('govt.dashboard.kpis.pendingAmount', { amount: fa.currency(kpis.pendingAmount) })
    ],
    [
      ar('govt.dashboard.kpis.collectionRate'),
      kpis.collectionRate === null ? '—' : fa.percent(kpis.collectionRate)
    ],
    [ar('govt.dashboard.kpis.certificates'), fa.number(kpis.certificatesIssued)],
    [
      ar('govt.dashboard.kpis.activeTrips'),
      fa.number(kpis.activeTrips),
      ar('govt.dashboard.kpis.activeTripsHint')
    ],
    [
      ar('govt.dashboard.kpis.vehicles'),
      fa.number(kpis.vehicles),
      ar('govt.dashboard.kpis.companies', { value: fa.number(kpis.companies) })
    ]
  ]

  const share = (value: number, total: number): string =>
    `${fa.compactCurrency(value)} · ${fa.percent(total > 0 ? value / total : 0)}`
  const cargoTotal = data.byCargo.reduce((sum, c) => sum + c.revenue, 0)
  const taxTotal = data.byTax.reduce((sum, c) => sum + c.revenue, 0)
  const breakdownTotal = data.breakdown.reduce((sum, r) => sum + r.revenue, 0)
  const labelOf = (row: (typeof data.breakdown)[number]): string =>
    breakdownLabel(row, data.breakdownBy, cities, ar, fa)
  const trips = (count: number): string =>
    ar('govt.dashboard.revenue.trips', { value: fa.number(count) })
  const empty = (
    <p className="py-4 text-center text-xs text-stone-500">{ar('govt.dashboard.empty')}</p>
  )
  const registered = Object.values(data.statusCounts).reduce((sum, n) => sum + n, 0)
  const billed = registered - data.statusCounts.draft - data.statusCounts.cancelled

  const page1: ReactNode[] = [
    <Section key="parameters" title={ar('report.parameters')} dense>
      {parameters.map(([label, value]) => (
        <Field key={label} label={label}>
          <bdi>{value}</bdi>
        </Field>
      ))}
    </Section>
  ]
  if (sections.has('kpis')) {
    page1.push(
      <Block key="kpis" title={ar('report.kpis')}>
        <div className="grid grid-cols-3 gap-2">
          {kpiTiles.map(([label, value, caption]) => (
            <div key={label} className="rounded border border-stone-200 px-3 py-2">
              <div className="text-[11px] text-stone-500">{label}</div>
              <div className="text-base font-bold text-stone-900 tabular-nums">{value}</div>
              {caption && <div className="text-[10px] text-stone-500">{caption}</div>}
            </div>
          ))}
        </div>
      </Block>
    )
  }
  if (sections.has('chart')) {
    page1.push(
      <Block key="chart" title={ar(`govt.dashboard.revenue.title.${data.bucket}`)}>
        <Suspense
          fallback={
            <div className="flex h-[250px] items-center justify-center text-stone-400">
              <LoaderCircle className="animate-spin" />
            </div>
          }
        >
          <RevenueChart
            points={data.revenueSeries}
            bucket={data.bucket}
            inProgress={data.to >= data.generatedAt}
            formatters={fa}
            translate={ar}
            size={CHART_SIZE}
          />
          <Ready onReady={() => setChartReady(true)} />
        </Suspense>
      </Block>
    )
  }

  // Trip progress as three figures, so it fits under the chart
  if (sections.has('progress')) {
    const steps: [string, number][] = [
      ['registered', registered],
      ['billed', billed],
      ['certified', data.statusCounts.certified]
    ]
    page1.push(
      <Block key="progress" title={ar('govt.dashboard.status.title')}>
        <div className="grid grid-cols-4 gap-2">
          {steps.map(([key, value]) => (
            <div key={key} className="rounded border border-stone-200 px-3 py-2">
              <div className="text-[11px] text-stone-500">{ar(`govt.dashboard.status.${key}`)}</div>
              <div className="text-base font-bold text-stone-900 tabular-nums">
                {fa.number(value)}
                <span className="ms-1.5 text-[11px] font-normal text-stone-500">
                  {fa.percent(registered > 0 ? value / registered : 0)}
                </span>
              </div>
            </div>
          ))}
          <p className="self-center text-[11px] text-stone-500">
            {ar('govt.dashboard.status.drafts', { value: fa.number(data.statusCounts.draft) })}
          </p>
        </div>
      </Block>
    )
  }

  const page2: ReactNode[] = []
  if (sections.has('cargo')) {
    page2.push(
      <Block key="cargo" title={ar('govt.dashboard.cargo.title')}>
        {data.byCargo.length === 0 ? (
          empty
        ) : (
          <BarList
            items={data.byCargo.map((c) => ({
              key: c.cargoType,
              label: ar(`cargoTypes.${c.cargoType}`),
              value: c.revenue,
              valueLabel: share(c.revenue, cargoTotal),
              detail: trips(c.trips)
            }))}
          />
        )}
      </Block>
    )
  }
  if (sections.has('tax')) {
    page2.push(
      <Block key="tax" title={ar('govt.dashboard.tax.title')}>
        {data.byTax.length === 0 ? (
          empty
        ) : (
          <BarList
            items={data.byTax.map((tax) => ({
              key: tax.code,
              label: tax.nameAr,
              value: tax.revenue,
              valueLabel: share(tax.revenue, taxTotal)
            }))}
          />
        )}
      </Block>
    )
  }
  if (sections.has('breakdown')) {
    page2.push(
      <Block
        key="breakdown"
        title={ar(`govt.dashboard.breakdown.title.${data.breakdownBy}`)}
        // Full width, so long route names fit
        className="col-span-2"
      >
        {data.breakdown.length === 0 ? (
          empty
        ) : (
          <BarList
            items={arrangeBreakdown(data.breakdown, view.sort, labelOf, 'ar').map((row) => ({
              key: row.key,
              label: labelOf(row),
              value: row.revenue,
              valueLabel: share(row.revenue, breakdownTotal),
              detail: trips(row.trips)
            }))}
          />
        )}
      </Block>
    )
  }
  const pages = page2.length > 0 ? [page1, page2] : [page1]
  const frame = {
    authority: [
      ar('certificate.header.republic'),
      ar('certificate.header.ministry'),
      ar('certificate.header.authority'),
      ar('certificate.header.department')
    ],
    barcodeAlt: '',
    date: { label: ar('report.generatedAt'), value: fa.dateTime(data.generatedAt) },
    title: ar('report.title'),
    qrLabel: '',
    footer: ar('report.footer')
  }

  // The browser's print dialog: "Save as PDF" there saves the report under this name
  const printReport = (): void =>
    printDocument(
      `masarat-report-${formatDay(new Date(data.from))}-${formatDay(new Date(data.to - 1))}`
    )

  // Rendered into <body> so the print styles can drop the rest of the app from the PDF
  return createPortal(
    <Modal labelledBy={titleId} onClose={onClose} className="print-dialog max-w-[calc(190mm+4rem)]">
      <div className="no-print mb-4 flex items-center justify-between gap-4">
        <h2 id={titleId} className="text-lg font-semibold">
          {t('govt.export.reportPreview')}
        </h2>
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
            {t('certificate.close')}
          </button>
          {/* Waits for the chart, so it's on the printed page */}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={!chartReady}
            onClick={printReport}
          >
            <Printer size={16} />
            {t('certificate.download')}
          </button>
        </div>
      </div>

      <div className="print-sheets flex flex-col gap-6">
        {pages.map((content, index) => (
          <DocumentSheet
            key={index}
            frame={frame}
            pageLabel={ar('certificate.page', {
              page: fa.number(index + 1),
              count: fa.number(pages.length)
            })}
          >
            <div
              className={
                index === 1 ? 'grid grid-cols-2 items-start gap-x-6 gap-y-5' : 'flex flex-col gap-4'
              }
            >
              {content}
            </div>
          </DocumentSheet>
        ))}
      </div>
    </Modal>,
    document.body
  )
}

export default ReportModal
