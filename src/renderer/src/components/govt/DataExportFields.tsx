import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import type { AnalyticsFilters } from '../../../../shared/analytics'
import {
  DATE_BASES,
  EXPORT_COLUMNS,
  EXPORT_FORMATS,
  EXPORT_DATASETS,
  EXPORT_STATUSES,
  type DateBasis,
  type ExportDataset,
  type ExportFormat,
  type ExportLabels,
  type ExportResult,
  type ExportStatus
} from '../../../../shared/exports'
import {
  CARGO_TYPES,
  ITEM_UNITS,
  MANIFEST_STATUSES,
  PAYMENT_STATUSES,
  TRIP_KINDS,
  VEHICLE_TYPES,
  type CityRecord,
  type FleetErrorCode
} from '../../../../shared/fleet'
import { LINE_CODES } from '../../../../shared/tax'
import { useFormat } from '../../lib/format'
import { useMountedRef } from '../../lib/useMountedRef'
import { FormAlert } from '../form/fields'

// Labels for a list of stored values, from one translation group
const labelsFor = (
  values: readonly string[],
  translate: (value: string) => string
): Record<string, string> => Object.fromEntries(values.map((v) => [v, translate(v)]))

// The data tab of the export dialog: datasets, which date the period applies to, the trip
// status, and the file format. The files are written in Arabic.
function DataExportFields({
  filters,
  cities,
  onClose
}: {
  filters: AnalyticsFilters
  cities: readonly CityRecord[]
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const [datasets, setDatasets] = useState<ReadonlySet<ExportDataset>>(() => new Set(['trips']))
  const [dateBasis, setDateBasis] = useState<DateBasis>('trip')
  const [status, setStatus] = useState<ExportStatus>('all')
  const [formats, setFormats] = useState<ReadonlySet<ExportFormat>>(() => new Set(['xlsx']))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)

  // Everything the main process writes into the files, in Arabic
  const labels = useMemo<ExportLabels>(() => {
    const ar = i18n.getFixedT('ar')
    const states = [...new Set(cities.map((c) => c.state))]
    return {
      sheets: labelsFor(EXPORT_DATASETS, (d) => ar(`govt.export.datasets.${d}`)) as Record<
        ExportDataset,
        string
      >,
      columns: Object.fromEntries(
        EXPORT_DATASETS.map((d) => [
          d,
          labelsFor(EXPORT_COLUMNS[d], (c) => ar(`export.columns.${d}.${c}`))
        ])
      ) as Record<ExportDataset, Record<string, string>>,
      values: {
        statuses: labelsFor(MANIFEST_STATUSES, (s) => ar(`statuses.${s}`)),
        paymentStatuses: labelsFor(PAYMENT_STATUSES, (s) => ar(`export.paymentStatuses.${s}`)),
        cargoTypes: labelsFor(CARGO_TYPES, (c) => ar(`cargoTypes.${c}`)),
        vehicleTypes: labelsFor(VEHICLE_TYPES, (v) => ar(`vehicleTypes.${v}`)),
        tripKinds: labelsFor(TRIP_KINDS, (k) => ar(`tripKinds.${k}`)),
        units: labelsFor(ITEM_UNITS, (u) => ar(`units.name.${u}`)),
        lines: labelsFor(LINE_CODES, (code) => ar(`taxes.${code}`)),
        states: labelsFor(states, (s) => ar(`states.${s}`, { defaultValue: s }))
      }
    }
  }, [i18n, cities])

  const toggle = (dataset: ExportDataset): void =>
    setDatasets((current) => {
      const next = new Set(current)
      if (next.has(dataset)) next.delete(dataset)
      else next.add(dataset)
      return next
    })

  const runExport = async (): Promise<void> => {
    setPending(true)
    setError(null)
    setResult(null)
    try {
      const response = await window.api.govt.exportData({
        filters,
        dateBasis,
        status,
        // In the dialog's order, whatever order they were ticked in
        datasets: EXPORT_DATASETS.filter((d) => datasets.has(d)),
        formats: EXPORT_FORMATS.filter((f) => formats.has(f)),
        labels
      })
      if (!mounted.current) return
      if (response.ok) setResult(response.data)
      else setError(response.error)
    } catch {
      if (mounted.current) setError('unknown')
    } finally {
      if (mounted.current) setPending(false)
    }
  }

  return (
    <>
      <fieldset className="flex flex-col gap-4 rounded-lg border border-stone-200 p-4">
        <legend className="px-1 text-sm font-semibold text-stone-800">
          {t('govt.export.dataOptions')}
        </legend>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-stone-500">
            {t('govt.export.datasetsLabel')}
          </span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {EXPORT_DATASETS.map((dataset) => (
              <label key={dataset} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-700"
                  checked={datasets.has(dataset)}
                  onChange={() => toggle(dataset)}
                />
                {t(`govt.export.datasets.${dataset}`)}
              </label>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-500">{t('govt.export.dateBasis')}</span>
            <select
              className="input py-1.5 text-sm"
              value={dateBasis}
              onChange={(e) => setDateBasis(e.target.value as DateBasis)}
            >
              {DATE_BASES.map((basis) => (
                <option key={basis} value={basis}>
                  {t(`govt.export.dateBases.${basis}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-stone-500">{t('govt.export.status')}</span>
            <select
              className="input py-1.5 text-sm"
              value={status}
              onChange={(e) => setStatus(e.target.value as ExportStatus)}
            >
              {EXPORT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`govt.export.statuses.${s}`)}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium text-stone-500">
              {t('govt.export.format')}
            </legend>
            {EXPORT_FORMATS.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-brand-700"
                  checked={formats.has(f)}
                  onChange={() =>
                    setFormats((current) => {
                      const next = new Set(current)
                      if (next.has(f)) next.delete(f)
                      else next.add(f)
                      return next
                    })
                  }
                />
                {t(`govt.export.formats.${f}`)}
              </label>
            ))}
          </fieldset>
        </div>
        <p className="text-xs text-stone-500">
          {t(
            formats.size > 1 || (formats.has('csv') && datasets.size > 1)
              ? 'govt.export.csvFolder'
              : 'govt.export.dataNote'
          )}
        </p>
      </fieldset>

      {error && <FormAlert message={t(`fleet.errors.${error}`)} />}
      {result?.saved && (
        <FormAlert
          tone="success"
          message={t('govt.export.dataSaved', {
            rows: format.list(
              EXPORT_DATASETS.filter((d) => result.rows[d] !== undefined).map((d) =>
                t('govt.export.rowCount', {
                  dataset: t(`govt.export.datasets.${d}`),
                  count: format.number(result.rows[d] ?? 0)
                })
              )
            )
          })}
        />
      )}

      <div className="flex justify-end gap-2 border-t border-stone-200 pt-4">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending || datasets.size === 0 || formats.size === 0}
          onClick={runExport}
        >
          {pending && <LoaderCircle size={16} className="animate-spin" />}
          {t('govt.export.exportData')}
        </button>
      </div>
    </>
  )
}

export default DataExportFields
