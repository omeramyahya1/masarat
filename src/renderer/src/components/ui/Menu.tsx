import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { EllipsisVertical } from 'lucide-react'

export interface MenuItem {
  label: ReactNode
  onSelect: () => void
  disabled?: boolean
}

// "⋯" button with a small popover menu; closes on outside click, Escape or selection
function Menu({ label, items }: { label: string; items: MenuItem[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent): void => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return (): void => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className="icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <EllipsisVertical size={18} />
      </button>
      {open && (
        <ul
          id={menuId}
          role="menu"
          className="card absolute end-0 top-full z-10 mt-1 min-w-48 overflow-hidden py-1 shadow-lg"
        >
          {items.map((item, index) => (
            <li key={index} role="none">
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-start text-sm text-stone-700 hover:bg-stone-50 disabled:opacity-50"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default Menu
