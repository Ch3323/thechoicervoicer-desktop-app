import { useRef } from 'react'
import { Archive, Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { OnlinePackDownload } from '@/hooks/useOnlinePackDownload'
import type { OnlinePackDownloadEntry } from '@studio/shared'

const phases = {
  preparing: 'Preparing…',
  queued: 'Queued',
  downloading: 'Downloading',
  importing: 'Importing',
} satisfies Record<OnlinePackDownloadEntry['phase'], string>

function statusText(entry: OnlinePackDownloadEntry) {
  switch (entry.status) {
    case 'working':
      return entry.cancelling ? 'Cancelling…' : phases[entry.phase]
    case 'saved':
      return 'Saved to device.'
    case 'imported':
      return `Added ${entry.title} to Local packs.`
    case 'cancelled':
      return 'Download cancelled.'
    case 'error':
      return 'Download failed.'
  }
}

export function OnlinePackDownloads({
  manager,
  isBrowsing,
}: {
  manager: OnlinePackDownload
  isBrowsing: boolean
}) {
  const {
    downloads,
    completedBytes,
    open,
    setOpen,
    refreshing,
    refresh,
    cancel,
    clearFinished,
  } = manager
  const toggle = useRef<HTMLButtonElement>(null)
  if (!isBrowsing && !downloads.length) return null

  const active = downloads.filter(({ status }) => status === 'working')
  const finished = downloads.filter(({ status }) => status !== 'working')
  const totalBytes = active.reduce(
    (bytes, entry) => bytes + entry.size,
    completedBytes,
  )
  const weightedProgress = active.reduce(
    (sum, entry) =>
      sum +
      entry.size * (entry.phase === 'importing' ? 100 : (entry.percent ?? 0)),
    completedBytes * 100,
  )
  const overallProgress = totalBytes
    ? Math.floor(weightedProgress / totalBytes)
    : 0
  const label = active.length ? `Downloads (${active.length})` : 'Downloads'
  const progressLabel = totalBytes
    ? `${overallProgress}% downloaded overall`
    : undefined
  const minimize = () => {
    setOpen(false)
    toggle.current?.focus()
  }

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-40 flex flex-col-reverse items-end gap-2">
      <Button
        ref={toggle}
        type="button"
        size="icon"
        variant="outline"
        aria-label={label}
        aria-description={progressLabel}
        aria-expanded={open}
        aria-controls={open ? 'online-pack-downloads' : undefined}
        title={progressLabel ? `${label} · ${progressLabel}` : label}
        className="pointer-events-auto relative size-12 rounded-full bg-card p-0 shadow-lg"
        onClick={() => setOpen(!open)}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-1 rounded-full"
          style={{
            background: `conic-gradient(var(--primary) ${overallProgress}%, var(--border) 0)`,
          }}
        >
          <span className="absolute inset-0.5 rounded-full bg-card" />
        </span>
        <Download aria-hidden="true" className="relative" />
        {active.length > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute -top-1.5 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-none font-semibold text-primary-foreground tabular-nums ring-2 ring-card"
          >
            {active.length}
          </span>
        )}
      </Button>
      {open && (
        <section
          id="online-pack-downloads"
          aria-label="Download activity"
          aria-busy={refreshing}
          className="pointer-events-auto w-full max-w-sm overflow-hidden border border-border bg-card text-card-foreground shadow-2xl"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              minimize()
            }
          }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <h2 className="text-sm font-semibold">Downloads</h2>
            <div className="flex gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8"
                aria-label="Refresh downloads"
                title="Refresh downloads"
                disabled={refreshing}
                onClick={() => void refresh()}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={
                    refreshing
                      ? 'animate-spin motion-reduce:animate-none'
                      : undefined
                  }
                />
              </Button>
            </div>
          </div>
          {!downloads.length && (
            <p className="px-4 py-5 text-sm text-muted-foreground">
              No downloads yet.
            </p>
          )}
          <ul
            hidden={!downloads.length}
            className="max-h-[min(45dvh,24rem)] divide-y divide-border overflow-y-auto overscroll-contain"
          >
            {[...active, ...finished].map((entry) => {
              const transferring =
                entry.status === 'working' &&
                (entry.phase === 'downloading' || entry.phase === 'importing')
              return (
                <li
                  key={entry.fileId}
                  className="flex items-start gap-3 px-4 py-3"
                >
                  <Archive
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium"
                      title={entry.name}
                    >
                      {entry.name}
                    </p>
                    <p
                      role="status"
                      className="mt-1 text-xs wrap-anywhere text-muted-foreground"
                    >
                      {statusText(entry)}
                    </p>
                    {transferring && (
                      <div className="mt-2 flex items-center gap-2">
                        <progress
                          aria-label={`${phases[entry.phase]} ${entry.name}`}
                          className="h-1.5 w-full appearance-none overflow-hidden rounded-full bg-muted [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&:indeterminate::-webkit-progress-bar]:bg-primary/35"
                          max={100}
                          value={entry.percent}
                        />
                        {entry.percent !== undefined && (
                          <span
                            aria-hidden="true"
                            className="text-xs tabular-nums text-muted-foreground"
                          >
                            {entry.percent}%
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {entry.status === 'working' && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 shrink-0 px-2 text-xs"
                      aria-label={`Cancel ${entry.name}`}
                      disabled={entry.cancelling}
                      onClick={() => void cancel(entry)}
                    >
                      Cancel
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          {finished.length > 0 && (
            <div className="flex justify-end border-t border-border px-3 py-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => void clearFinished()}
              >
                Clear finished
              </Button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
