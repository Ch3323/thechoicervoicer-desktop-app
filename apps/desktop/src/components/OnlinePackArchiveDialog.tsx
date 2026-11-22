import { useEffect, useId, useRef, useState } from 'react'
import { ChevronRight, File, Folder, X } from 'lucide-react'
import type { OnlinePackArchiveEntry, OnlinePackFile } from '@studio/shared'
import { OnlinePackSpinner } from '@/components/OnlinePackSpinner'
import { Button } from '@/components/ui/button'

export function OnlinePackArchiveDialog({
  packId,
  file,
  onClose,
}: {
  packId: number
  file: OnlinePackFile
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [attempt, setAttempt] = useState(0)
  const [entries, setEntries] = useState<OnlinePackArchiveEntry[] | null>()

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

  useEffect(() => {
    let active = true
    window.studio.getOnlinePackArchiveContents(packId, file.id).then(
      (result) => {
        if (active) setEntries(result)
      },
      () => {
        if (active) setEntries(null)
      },
    )
    return () => {
      active = false
    }
  }, [packId, file.id, attempt])

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-2xl overflow-hidden border border-border bg-card text-foreground shadow-2xl"
    >
      <div className="flex max-h-[75dvh] flex-col">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border p-5">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold">
              File contents
            </h2>
            <p className="mt-1 text-sm break-all text-muted-foreground">
              {file.name}
            </p>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="shrink-0"
            aria-label="Close file contents"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        </header>
        <div className="min-h-0 overflow-y-auto p-5">
          {entries === undefined && (
            <OnlinePackSpinner label="Loading file contents" />
          )}
          {entries === null && (
            <div className="text-center">
              <p role="alert" className="text-sm">
                Couldn’t load the archive contents.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setEntries(undefined)
                  setAttempt((value) => value + 1)
                }}
              >
                Try again
              </Button>
            </div>
          )}
          {entries &&
            (entries.length ? (
              <ArchiveTree entries={entries} expandRoot />
            ) : (
              <p className="text-center text-sm text-muted-foreground">
                No files in the archive listing.
              </p>
            ))}
        </div>
      </div>
    </dialog>
  )
}

function ArchiveTree({
  entries,
  expandRoot = false,
}: {
  entries: OnlinePackArchiveEntry[]
  expandRoot?: boolean
}) {
  return (
    <ul className="space-y-1 text-sm">
      {entries.map(({ name, children }, index) => (
        <li key={index} className="min-w-0">
          {children ? (
            <details
              className="[&[open]>summary>svg:first-child]:rotate-90"
              open={expandRoot && entries.length === 1 ? true : undefined}
            >
              <summary className="flex cursor-pointer list-none items-start gap-2 rounded px-1 py-1 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
                <Folder
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-primary"
                />
                <span className="font-medium break-all">{name}</span>
              </summary>
              <div className={`ml-3 pl-3${children.length > 0 ? ' border-l border-border' : ''}`}>
                {children.length > 0 ? (
                  <ArchiveTree entries={children} />
                ) : (
                  <p className="py-1 text-center text-xs text-muted-foreground">
                    Empty folder
                  </p>
                )}
              </div>
            </details>
          ) : (
            <div className="flex items-start gap-2 px-1 py-1">
              <File
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
              <span className="break-all">{name}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
