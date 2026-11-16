import { useEffect, useRef } from 'react'
import type { ImportProgress } from '@studio/shared'

export function ImportProgressDialog({
  progress,
}: {
  progress: ImportProgress
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (dialog.showModal) dialog.showModal()
    else dialog.setAttribute('open', '')
    dialog.focus()
    return () => {
      if (dialog.close && dialog.open) dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [])

  const percent =
    progress.phase === 'extracting' && progress.totalBytes > 0
      ? Math.min(
          100,
          Math.round((progress.completedBytes / progress.totalBytes) * 100),
        )
      : null
  const label = {
    scanning: 'Checking ZIP archive…',
    extracting: 'Importing Dub Pack…',
    saving: 'Saving Dub Pack…',
  }[progress.phase]

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-labelledby="import-progress-title"
      aria-describedby="import-progress-description"
      onCancel={(event) => event.preventDefault()}
      className="import-progress-dialog border border-border bg-card p-6 text-foreground"
    >
      <p className="eyebrow cyan">DUB PACK / IMPORT</p>
      <h2 id="import-progress-title" className="mt-2 text-2xl font-black">
        {label}
      </h2>
      <p
        id="import-progress-description"
        className="mt-3 text-sm text-muted-foreground"
      >
        Keep this window open while the pack is added to your library.
      </p>
      <progress
        className="import-progress-bar mt-6 h-3 w-full overflow-hidden rounded-full"
        max={100}
        value={percent ?? undefined}
        aria-label="ZIP import progress"
      />
      <p
        className="mt-2 text-right text-sm font-semibold text-primary"
        role="status"
      >
        {percent === null ? label : `${percent}%`}
      </p>
    </dialog>
  )
}
