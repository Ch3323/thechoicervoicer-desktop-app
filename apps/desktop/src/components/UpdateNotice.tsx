import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { runUpdateAction, useUpdateStatus } from '@/hooks/useUpdateStatus'
import { reportError } from '@/lib/error-toast'

export function UpdateNotice() {
  const status = useUpdateStatus()
  const [postponedVersion, setPostponedVersion] = useState<string | undefined>()
  const { phase, message } = status
  useEffect(() => {
    if (phase === 'error') reportError(message, 'The update failed. Please try again.')
  }, [phase, message])
  if (status.phase !== 'available' && status.phase !== 'downloading' && status.phase !== 'downloaded') return null
  if (status.phase === 'available' && postponedVersion === status.version) return null
  return (
    <div role="status" className="fixed bottom-4 right-4 z-50 max-w-sm border border-border bg-card p-4 shadow-xl">
      <p className="font-medium">{status.phase === 'downloaded' ? 'Update ready to install' : `Version ${status.version ?? ''} available`}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {status.phase === 'downloading' ? `Downloading… ${status.percent ?? 0}%` : status.message ?? 'A new version of the studio is available.'}
      </p>
      <div className="mt-3 flex gap-2">
        {status.phase === 'available' && <Button className="rounded-none" size="sm" onClick={() => void runUpdateAction(window.studio.downloadUpdate)}>Download</Button>}
        {status.phase === 'downloaded' && <Button className="rounded-none" size="sm" onClick={() => void runUpdateAction(window.studio.installUpdate)}>Install and restart</Button>}
        {status.phase === 'available' && <Button className="rounded-none" size="sm" variant="outline" onClick={() => setPostponedVersion(status.version)}>Later</Button>}
      </div>
    </div>
  )
}
