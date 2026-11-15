import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'

type ConfirmDialogProps = {
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (dialog.showModal) dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => {
      if (dialog.close && dialog.open) dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-dialog-title"
      aria-describedby="confirm-dialog-description"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const bounds = event.currentTarget.getBoundingClientRect()
        const { clientX, clientY } = event
        if (clientX < bounds.left || clientX > bounds.right || clientY < bounds.top || clientY > bounds.bottom) {
          onCancel()
        }
      }}
      className="confirm-dialog rounded-2xl border border-border bg-card p-6 text-foreground"
    >
      <h2 id="confirm-dialog-title" className="text-2xl font-black">
        {title}
      </h2>
      <p
        id="confirm-dialog-description"
        className="mt-3 text-sm leading-6 text-muted-foreground"
      >
        {description}
      </p>
      <div className="mt-7 flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          className="bg-red-500 text-white hover:bg-red-400"
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
