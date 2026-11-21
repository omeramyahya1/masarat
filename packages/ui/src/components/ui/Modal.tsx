import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  labelledBy: string
  onClose: () => void
  className?: string
  children: ReactNode
}

// Native modal dialog, open while mounted: keeps focus inside, makes the rest of the app inert,
// and closes on Escape. Focus returns to whatever opened it.
function Modal({
  labelledBy,
  onClose,
  className = 'max-w-md',
  children
}: ModalProps): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    const opener = document.activeElement as HTMLElement | null
    if (dialog && !dialog.open) dialog.showModal()
    return (): void => {
      if (dialog?.open) dialog.close()
      opener?.focus()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className={`card m-auto w-full p-6 text-stone-900 shadow-xl backdrop:bg-stone-900/40 ${className}`}
      aria-labelledby={labelledBy}
      // Escape: let the parent unmount us instead of the browser closing the dialog on its own
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      {children}
    </dialog>
  )
}

export default Modal
