import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LoaderCircle } from 'lucide-react'
import type { AnalyticsFilters } from '@masarat/shared/analytics'
import {
  DATE_BASES,
  EXCEL_MAX_ROWS,
  EXPORT_COLUMNS,
  EXPORT_FORMATS,
  EXPORT_DATASETS,
  EXPORT_STATUSES,
  type DateBasis,
  type ExportDataset,
  type ExportFormat,
  type ExportJob,
  type ExportLabels,
  type ExportRows,
  type ExportStatus
} from '@masarat/shared/exports'
import {
  CARGO_TYPES,
  ITEM_UNITS,
  MANIFEST_STATUSES,
  PAYMENT_STATUSES,
  TRIP_KINDS,
  VEHICLE_TYPES,
  type FleetErrorCode
} from '@masarat/shared/fleet'
import { ID_TYPES } from '@masarat/shared/passengers'
import { TRIP_CATEGORIES } from '@masarat/shared/tax'
import { useFormat } from '@masarat/ui/lib/format'
import { useMountedRef } from '@masarat/ui/lib/useMountedRef'
import { FormAlert } from '@masarat/ui/components/form/fields'
import { saveFile } from '@masarat/ui/lib/saveFile'
import { api } from '@masarat/api-client'
import { errorCode, queryKeys, unwrap } from '@masarat/ui/lib/query'

// Labels for a list of stored values, from one translation group
const labelsFor = (
  values: readonly string[],
  translate: (value: string) => string
): Record<string, string> => Object.fromEntries(values.map((v) => [v, translate(v)]))

const IN_PROGRESS: readonly ExportJob['status'][] = ['queued', 'running']

// The data tab of the export dialog: datasets, which date the period applies to, the trip
// status, and the file format. The files are written in Arabic. The export worker prepares them:
// the dialog queues the export, follows it (the account's latest export, polled while it's queued
// or being prepared, so closing and reopening the dialog picks it up again), and saves the file
// when it's ready.
function DataExportFields({
  filters,
  onClose
}: {
  filters: AnalyticsFilters
  onClose: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const format = useFormat()
  const mounted = useMountedRef()
  const [datasets, setDatasets] = useState<ReadonlySet<ExportDataset>>(() => new Set(['trips']))
  const [dateBasis, setDateBasis] = useState<DateBasis>('trip')
  const [status, setStatus] = useState<ExportStatus>('all')
  const [formats, setFormats] = useState<ReadonlySet<ExportFormat>>(() => new Set(['xlsx']))
  // Passengers' ID numbers are personal data: left out of the files unless asked for
  const [includeIdNumbers, setIncludeIdNumbers] = useState(false)
  const queryClient = useQueryClient()
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<FleetErrorCode | null>(null)
  // Rows per dataset of the last file downloaded
  const [result, setResult] = useState<ExportRows | null>(null)
  // The export queued from this dialog: its file is saved as soon as it's ready, once
  const [startedHere, setStartedHere] = useState<string | null>(null)
  const autoSaved = useRef<string | null>(null)
  // That automatic save failed: Download offers it again
  const [autoSaveFailed, setAutoSaveFailed] = useState<string | null>(null)

  const job = useQuery({
    queryKey: queryKeys.exportJob,
    queryFn: () => unwrap(api.govt.exports.current()),
    staleTime: 0,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      query.state.data && IN_PROGRESS.includes(query.state.data.status) ? 2_000 : false
  })
  const current = job.data ?? null
  const inProgress = current !== null && IN_PROGRESS.includes(current.status)

  // Downloads and saves the file; false when that failed (the error is shown)
  const saveExport = async (id: string): Promise<boolean> => {
    try {
      const response = await api.govt.exports.file(id)
      if (!response.ok) {
        if (mounted.current) setError(response.error)
        return false
      }
      // Saved even if the dialog was closed meanwhile
      saveFile(response.data)
      if (mounted.current) {
        setError(null)
        setResult(response.data.rows)
      }
      return true
    } catch {
      if (mounted.current) setError('unknown')
      return false
    }
  }

  // The export queued here is saved once it's ready (one try; if it fails, Download is offered);
  // an earlier one waits for Download
  useEffect(() => {
    if (
      current?.status === 'done' &&
      current.id === startedHere &&
      autoSaved.current !== current.id
    ) {
      const id = current.id
      autoSaved.current = id
      void saveExport(id).then((ok) => {
        if (!ok && mounted.current) setAutoSaveFailed(id)
      })
    }
  })

  // Everything the API writes into the files, in Arabic
  const labels = useMemo<ExportLabels>(() => {
    const ar = i18n.getFixedT('ar')
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
        units: labelsFor([...ITEM_UNITS, 'seat'], (u) => ar(`units.name.${u}`)),
        categories: labelsFor(TRIP_CATEGORIES, (c) => ar(`tripCategories.${c}`)),
        idTypes: labelsFor(ID_TYPES, (type) => ar(`idTypes.${type}`)),
        yesNo: { true: ar('common.yes'), false: ar('common.no') }
      }
    }
  }, [i18n])

  const toggle = (dataset: ExportDataset): void =>
    setDatasets((current) => {
      const next = new Set(current)
      if (next.has(dataset)) next.delete(dataset)
      else next.add(dataset)
      return next
    })

  const runExport = async (): Promise<void> => {
    setStarting(true)
    setError(null)
    setResult(null)
    try {
      const response = await api.govt.exports.start({
        filters,
        dateBasis,
        status,
        // In the dialog's order, whatever order they were ticked in
        datasets: EXPORT_DATASETS.filter((d) => datasets.has(d)),
        formats: EXPORT_FORMATS.filter((f) => formats.has(f)),
        includeIdNumbers: datasets.has('passengers') && includeIdNumbers,
        labels
      })
      if (!response.ok) {
        if (mounted.current) setError(response.error)
        // Another export of this account is under way: show it
        if (response.error === 'export_in_progress') void job.refetch()
        return
      }
      setStartedHere(response.data.id)
      // A fetch of the job started before this one could land after it and replace it
      await queryClient.cancelQueries({ queryKey: queryKeys.exportJob })
      queryClient.setQueryData(queryKeys.exportJob, response.data)
    } catch {
      if (mounted.current) setError('unknown')
    } finally {
      if (mounted.current) setStarting(false)
    }
  }

  const cancelExport = async (): Promise<void> => {
    if (!current) return
    const response = await api.govt.exports.cancel(current.id)
    if (response.ok) {
      await queryClient.cancelQueries({ queryKey: queryKeys.exportJob })
      queryClient.setQueryData(queryKeys.exportJob, response.data)
    } else if (mounted.current) setError(response.error)
  }

  // A failed export's reason, with the counts when a dataset is over Excel's limit
  const failure: FleetErrorCode | null =
    error ??
    (current?.status === 'failed' ? current.error : null) ??
    errorCode<FleetErrorCode>(job.error)
  const tooLarge = current?.status === 'failed' ? current.rows : null
  const rowsText = (rows: ExportRows): string =>
    format.list(
      EXPORT_DATASETS.filter((d) => rows[d] !== undefined).map((d) =>
        t('govt.export.rowCount', {
          dataset: t(`govt.export.datasets.${d}`),
          count: format.number(rows[d] ?? 0)
        })
      )
    )

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
          {datasets.has('passengers') && (
            <label className="flex items-start gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                className="mt-0.5 size-4 accent-brand-700"
                checked={includeIdNumbers}
                onChange={(e) => setIncludeIdNumbers(e.target.checked)}
              />
              <span>
                {t('govt.export.includeIdNumbers')}
                <span className="block text-xs text-stone-500">
                  {t('govt.export.includeIdNumbersHint')}
                </span>
              </span>
            </label>
          )}
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

      {failure && (
        <FormAlert
          message={
            failure === 'export_too_large_for_excel' && tooLarge
              ? t('fleet.errors.export_too_large_for_excel', {
                  rows: format.list(
                    EXPORT_DATASETS.filter((d) => (tooLarge[d] ?? 0) > EXCEL_MAX_ROWS).map((d) =>
                      t('govt.export.rowCount', {
                        dataset: t(`govt.export.datasets.${d}`),
                        count: format.number(tooLarge[d] ?? 0)
                      })
                    )
                  ),
                  limit: format.number(EXCEL_MAX_ROWS)
                })
              : t(`fleet.errors.${failure}`)
          }
        />
      )}
      {inProgress && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900"
        >
          <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin" />
          <div className="flex flex-1 flex-col gap-1">
            <span>
              {current.status === 'queued'
                ? current.ahead
                  ? t('govt.export.queued', { count: current.ahead })
                  : t('govt.export.queuedNext')
                : t('govt.export.preparing')}
            </span>
            <span className="text-xs text-brand-800">{t('govt.export.keepsGoing')}</span>
          </div>
          <button type="button" className="btn btn-secondary py-1 text-xs" onClick={cancelExport}>
            {t('govt.export.cancelExport')}
          </button>
        </div>
      )}
      {result ? (
        <FormAlert
          tone="success"
          message={t('govt.export.dataSaved', { rows: rowsText(result) })}
        />
      ) : (
        current?.status === 'done' &&
        (current.id !== startedHere || current.id === autoSaveFailed) && (
          <div className="flex items-center gap-3 rounded-lg border border-stone-200 p-3 text-sm">
            <span className="flex-1">
              {t('govt.export.ready', { rows: rowsText(current.rows ?? {}) })}
            </span>
            <button
              type="button"
              className="btn btn-secondary py-1 text-xs"
              onClick={() => void saveExport(current.id)}
            >
              {t('govt.export.download')}
            </button>
          </div>
        )
      )}

      <div className="flex justify-end gap-2 border-t border-stone-200 pt-4">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={starting || inProgress || datasets.size === 0 || formats.size === 0}
          onClick={runExport}
        >
          {starting && <LoaderCircle size={16} className="animate-spin" />}
          {t('govt.export.exportData')}
        </button>
      </div>
    </>
  )
}

export default DataExportFields
