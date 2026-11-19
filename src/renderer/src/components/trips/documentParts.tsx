// Building blocks shared by the printed documents (the payment receipt and the authorized
// manifest). The documents are always in Arabic, so these take already-translated text.
import type { ReactNode } from 'react'
import emblem from '../../assets/sudan-emblem.svg'
import type { SheetFrame } from './documentFrame'

export function Section({
  title,
  columns = 2,
  dense,
  children
}: {
  title: string
  // Two columns of fields, or one when the section sits in a narrow column
  columns?: 1 | 2
  // Tighter rows, so the manifest fits more on a page
  dense?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <section className="break-inside-avoid">
      <h4 className="mb-1 border-b border-brand-700 pb-1 text-[13px] font-bold text-brand-800">
        {title}
      </h4>
      <dl
        className={`grid gap-x-6 text-[12.5px] ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'} ${dense ? '[&>div]:py-1' : ''}`}
      >
        {children}
      </dl>
    </section>
  )
}

export function Field({
  label,
  wide,
  children
}: {
  label: string
  // Spans both columns (long values such as the bill ID)
  wide?: boolean
  children: ReactNode
}): React.JSX.Element {
  return (
    <div
      className={`flex justify-between gap-3 border-0 border-b border-dotted border-stone-300 py-1.5 ${wide ? 'col-span-2' : ''}`}
    >
      <dt className="shrink-0 text-stone-500">{label}</dt>
      <dd className="text-start font-semibold text-stone-900">{children}</dd>
    </div>
  )
}

// Latin values (document numbers, bill IDs) keep their left-to-right order inside Arabic text
export function Latin({ children }: { children: string }): React.JSX.Element {
  return (
    <span dir="ltr" className="font-mono">
      {children}
    </span>
  )
}

// One printed page (the A4 content box inside the 10 mm page margin): the letterhead, the page's
// content, and a footer with the QR code at the bottom left and the page number. A document longer
// than a page is split into several sheets, so every page carries the barcode and the QR.
export function DocumentSheet({
  frame,
  continued,
  pageLabel,
  measuring,
  className = '',
  children
}: {
  frame: SheetFrame
  // A later page of the same document: its title says so
  continued?: string
  // "صفحة 1 من 2"
  pageLabel: string
  // The hidden copy the pages are measured on: marks its content area for usePagedRows
  measuring?: boolean
  className?: string
  children: ReactNode
}): React.JSX.Element {
  const [republic, ...rest] = frame.authority
  return (
    <article
      dir="rtl"
      lang="ar"
      className={`print-sheet mx-auto flex h-[276mm] w-[190mm] flex-col gap-3 overflow-hidden rounded-lg border-2 border-double border-brand-800 bg-white px-6 py-5 text-stone-900 select-text ${className}`}
    >
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        <div className="flex flex-col gap-0.5 text-[13px] leading-snug font-bold">
          <span className="text-[15px]">{republic}</span>
          {rest.map((line, index) => (
            <span
              key={line}
              className={index === rest.length - 1 ? 'font-semibold text-stone-600' : ''}
            >
              {line}
            </span>
          ))}
        </div>
        <img src={emblem} alt="" className="h-20 w-auto" />
        {/* The left edge (the end, in Arabic): the barcode, then the issue date */}
        <div className="flex flex-col items-end gap-1 text-[11px]">
          {frame.barcode && (
            <img src={frame.barcode} alt={frame.barcodeAlt} className="h-11 w-auto max-w-52" />
          )}
          <span className="text-stone-500">
            {frame.date.label}:{' '}
            <span className="font-semibold text-stone-900">{frame.date.value}</span>
          </span>
        </div>
      </header>
      <h3 className="border-y-2 border-brand-800 py-1.5 text-center text-lg font-bold text-brand-900">
        {frame.title}
        {continued && (
          <span className="ms-2 text-sm font-semibold text-stone-500">{continued}</span>
        )}
      </h3>

      <div
        data-measure={measuring ? 'body' : undefined}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden"
      >
        {children}
      </div>

      {/* The QR code last, so it sits at the bottom left */}
      <footer className="flex items-end justify-between gap-4 border-t border-stone-200 pt-2">
        <div className="flex flex-col gap-1 pb-1 text-[11px] text-stone-500">
          <span>{frame.footer}</span>
          <span className="font-semibold text-stone-700">{pageLabel}</span>
        </div>
        {frame.qr && (
          <figure className="flex shrink-0 flex-col items-center gap-0.5">
            <img
              src={frame.qr}
              alt={frame.qrLabel}
              className="size-20 rounded border border-stone-200"
            />
            <figcaption className="text-[10px] text-stone-500">{frame.qrLabel}</figcaption>
          </figure>
        )}
      </footer>
    </article>
  )
}
