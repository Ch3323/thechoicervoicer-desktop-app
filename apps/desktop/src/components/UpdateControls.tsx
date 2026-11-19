import { Check, RefreshCcw } from 'lucide-react'
import type { UpdateStatus } from '@studio/shared'
import { Button } from '@/components/ui/button'
import { runUpdateAction, useUpdateStatus } from '@/hooks/useUpdateStatus'

function lastCheckedText(checkedAt?: string): string {
  if (!checkedAt) return 'Last checked: Not yet'
  const date = new Date(checkedAt)
  if (Number.isNaN(date.getTime())) return 'Last checked: Not yet'
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const day = sameDay
    ? 'Today'
    : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
  return `Last checked: ${day}, ${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
}

function heading(status: UpdateStatus): string {
  switch (status.phase) {
    case 'current': return "You're up to date"
    case 'available': return 'Update available'
    case 'downloading': return 'Downloading update'
    case 'downloaded': return 'Update ready to install'
    case 'checking': return 'Checking for updates'
    case 'error': return 'Update failed'
    case 'disabled': return 'Update checks unavailable'
    case 'idle': return 'Check for updates'
  }
}

function detail(status: UpdateStatus, compact: boolean): string | null {
  switch (status.phase) {
    case 'available': return `Version ${status.version ?? 'new'} is ready to download. You decide when to update.`
    case 'downloading': return `Downloading… ${status.percent ?? 0}%`
    case 'downloaded': return `Version ${status.version ?? 'new'} is ready. Install when you are ready.`
    case 'checking': return 'Looking for a newer version on GitHub…'
    case 'disabled': return compact
      ? 'Install a GitHub release to check.'
      : status.message?.includes('no update feed')
      ? status.message
      : 'Install a GitHub release to check for updates.'
    default: return null
  }
}

export function UpdateControls({ compact = false }: { compact?: boolean }) {
  const status = useUpdateStatus()
  const description = detail(status, compact)

  return (
    <section aria-label="Updates" className={compact
      ? 'grid grid-cols-[20px_minmax(0,1fr)] items-start gap-x-3 gap-y-2 px-[10px] py-[14px] text-foreground'
      : 'flex flex-wrap items-center gap-4 p-4 text-foreground md:flex-nowrap'}>
      <div className={`relative shrink-0 ${compact ? 'mt-0.5 size-5' : 'size-[72px]'}`} aria-hidden="true">
        <RefreshCcw className={`!h-full !w-full text-primary ${status.phase === 'checking' ? 'animate-spin' : ''}`} strokeWidth={2.1} />
        {status.phase === 'current' && (
          <span className={`absolute bottom-0 right-0 grid place-items-center rounded-full bg-primary text-primary-foreground ${compact ? 'size-3 translate-x-1 translate-y-1' : 'size-8'}`}>
            <Check className={compact ? '!size-2' : '!size-4'} strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p role="status" className={`${compact ? 'text-sm' : 'text-[17px]'} font-semibold leading-tight`}>{heading(status)}</p>
        {description && <p className="mt-1 text-xs leading-snug text-muted-foreground">{description}</p>}
        <p className={`mt-0.5 text-muted-foreground ${compact ? 'text-[11px]' : 'text-xs'}`}>{lastCheckedText(status.checkedAt)}</p>
        {status.phase === 'downloading' && (
          <progress aria-label="Update download progress" className="mt-2 w-full accent-primary" value={status.percent ?? 0} max={100} />
        )}
      </div>
      <div className={`flex flex-wrap gap-2 ${compact ? 'col-start-2 justify-start' : 'shrink-0'}`}>
        <Button className={compact ? 'h-8 px-2 text-xs' : undefined} size="sm" onClick={() => void runUpdateAction(window.studio.checkForUpdates)}>
          Check for updates
        </Button>
        {status.phase === 'available' && (
          <Button className={compact ? 'h-8 px-2 text-xs' : undefined} size="sm" onClick={() => void runUpdateAction(window.studio.downloadUpdate)}>{compact ? 'Download' : 'Download update'}</Button>
        )}
        {status.phase === 'downloaded' && (
          <Button className={compact ? 'h-8 px-2 text-xs' : undefined} size="sm" onClick={() => void runUpdateAction(window.studio.installUpdate)}>{compact ? 'Install' : 'Install and restart'}</Button>
        )}
      </div>
    </section>
  )
}
