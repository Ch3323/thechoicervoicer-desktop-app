import { useState } from 'react'
import type { UpdateStatus } from '@studio/shared'
import { Button } from '@/components/ui/button'
import { useUpdateStatus } from '@/hooks/useUpdateStatus'

function statusText(status: UpdateStatus): string {
  if (status.message) return status.message
  switch (status.phase) {
    case 'disabled': return 'Updates are available in installed Windows releases.'
    case 'idle': return 'Ready to check for updates.'
    case 'checking': return 'Checking for updates…'
    case 'available': return `Version ${status.version ?? ''} is available.`
    case 'downloading': return `Downloading version ${status.version ?? ''}… ${status.percent ?? 0}%`
    case 'downloaded': return `Version ${status.version ?? ''} is ready to install.`
    case 'current': return 'You are up to date.'
    case 'error': return 'Update check failed.'
  }
}

export function UpdateControls() {
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

  return (
    <div className="min-w-0">
      <p role="status" className="text-sm text-muted-foreground">{actionError ?? statusText(status)}</p>
      {status.phase === 'downloading' && (
        <progress aria-label="Update download progress" className="mt-2 w-full" value={status.percent ?? 0} max={100} />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="rounded-none" size="sm" variant="outline" disabled={status.phase === 'disabled' || status.phase === 'checking' || status.phase === 'downloading' || status.phase === 'downloaded'} onClick={() => void run(window.studio.checkForUpdates)}>
          Check for updates
        </Button>
        {status.phase === 'available' && (
          <Button className="rounded-none" size="sm" onClick={() => void run(window.studio.downloadUpdate)}>Download update</Button>
        )}
        {status.phase === 'downloaded' && (
          <Button className="rounded-none" size="sm" onClick={() => void run(window.studio.installUpdate)}>Install and restart</Button>
        )}
      </div>
    </div>
  )
}
