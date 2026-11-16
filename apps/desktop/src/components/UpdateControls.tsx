import { useState } from 'react'
import { Check, RefreshCcw } from 'lucide-react'
import type { UpdateStatus } from '@studio/shared'
import { Button } from '@/components/ui/button'
import { useUpdateStatus } from '@/hooks/useUpdateStatus'

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
    case 'error': return 'Could not check for updates'
    case 'disabled': return 'Update checks unavailable'
    case 'idle': return 'Check for updates'
  }
}

function detail(status: UpdateStatus): string | null {
  switch (status.phase) {
    case 'available': return `Version ${status.version ?? 'new'} is ready to download. You decide when to update.`
    case 'downloading': return `Downloading… ${status.percent ?? 0}%`
    case 'downloaded': return `Version ${status.version ?? 'new'} is ready. Install when you are ready.`
    case 'checking': return 'Looking for a newer version on GitHub…'
    case 'error': return status.message ?? 'Try checking again.'
    case 'disabled': return status.message?.includes('no update feed')
      ? status.message
      : 'Install a GitHub release to check for updates.'
    default: return null
  }
}

export function UpdateControls({ compact = false }: { compact?: boolean }) {
  const status = useUpdateStatus()
  const [actionError, setActionError] = useState<string | null>(null)
  const run = async (action: () => Promise<void>) => {
    setActionError(null)
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    }
  }
  const description = actionError ?? detail(status)

  return (
    <section aria-label="Updates" className={`flex items-center gap-4 p-4 text-foreground ${compact ? 'flex-wrap' : 'flex-wrap md:flex-nowrap'}`}>
      <div className={`relative shrink-0 ${compact ? 'size-14' : 'size-[72px]'}`} aria-hidden="true">
        <RefreshCcw className={`!h-full !w-full text-primary ${status.phase === 'checking' ? 'animate-spin' : ''}`} strokeWidth={2.1} />
        {status.phase === 'current' && (
          <span className="absolute bottom-0 right-0 grid size-8 place-items-center rounded-full bg-primary text-primary-foreground">
            <Check className="!size-4" strokeWidth={3} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p role="status" className="text-[17px] font-semibold leading-tight">{heading(status)}</p>
        {description && <p className="mt-1 text-xs leading-snug text-muted-foreground">{description}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">{lastCheckedText(status.checkedAt)}</p>
        {status.phase === 'downloading' && (
          <progress aria-label="Update download progress" className="mt-2 w-full accent-primary" value={status.percent ?? 0} max={100} />
        )}
      </div>
      <div className={`flex flex-wrap gap-2 ${compact ? 'w-full justify-end' : 'shrink-0'}`}>
        <Button size="sm" onClick={() => void run(window.studio.checkForUpdates)}>
          Check for updates
        </Button>
        {status.phase === 'available' && (
          <Button size="sm" onClick={() => void run(window.studio.downloadUpdate)}>Download update</Button>
        )}
        {status.phase === 'downloaded' && (
          <Button size="sm" onClick={() => void run(window.studio.installUpdate)}>Install and restart</Button>
        )}
      </div>
    </section>
  )
}
