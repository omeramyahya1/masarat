// Building blocks shared by the printed documents (the payment receipt and the authorized
// manifest). The documents are always in Arabic, so these take already-translated text.
import type { ReactNode } from 'react'
import emblem from '../../assets/sudan-emblem.svg'

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

// The issuing authority and the Sudan emblem, then the document's barcode (its number) beside
// the verification QR code and the issue date, then the document's title
export function DocumentHeader({
  authority,
  barcode,
  numberLabel,
  qr,
  qrLabel,
  date,
  title
}: {
  // Republic, ministry, authority and department, top to bottom
  authority: readonly string[]
  // Code 128 barcode of the document number (the number is printed under the bars)
  barcode: string
  numberLabel: string
  qr: string
  qrLabel: string
  date: { label: string; value: string }
  title: string
}): React.JSX.Element {
  const [republic, ...rest] = authority
  return (
    <>
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
        <div className="flex items-start justify-end gap-3">
          <div className="flex flex-col items-center gap-1 text-[11px]">
            <img src={barcode} alt={numberLabel} className="h-12 w-auto max-w-60" />
            <span className="text-stone-500">{numberLabel}</span>
            <span className="text-stone-500">
              {date.label}: <span className="font-semibold text-stone-900">{date.value}</span>
            </span>
          </div>
          <figure className="flex flex-col items-center gap-0.5">
            <img src={qr} alt={qrLabel} className="size-20 rounded border border-stone-200" />
            <figcaption className="text-[10px] text-stone-500">{qrLabel}</figcaption>
          </figure>
        </div>
      </header>
      <h3 className="border-y-2 border-brand-800 py-1.5 text-center text-lg font-bold text-brand-900">
        {title}
      </h3>
    </>
  )
}
