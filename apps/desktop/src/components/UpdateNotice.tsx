import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useUpdateStatus } from '@/hooks/useUpdateStatus'

export function UpdateNotice() {
  const status = useUpdateStatus()
  const [postponedVersion, setPostponedVersion] = useState<string | undefined>()
  if (status.phase !== 'available' && status.phase !== 'downloading' && status.phase !== 'downloaded') return null
  if (status.phase === 'available' && postponedVersion === status.version) return null
  return (
    <div role="status" className="fixed bottom-4 right-4 z-50 max-w-sm border border-border bg-card p-4 shadow-xl">
      <p className="font-medium">{status.phase === 'downloaded' ? 'Update ready to install' : `Version ${status.version ?? ''} available`}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {status.phase === 'downloading' ? `Downloading… ${status.percent ?? 0}%` : status.message ?? 'A new version of the studio is available.'}
      </p>
      <div className="mt-3 flex gap-2">
        {status.phase === 'available' && <Button className="rounded-none" size="sm" onClick={() => void window.studio.downloadUpdate()}>Download</Button>}
        {status.phase === 'downloaded' && <Button className="rounded-none" size="sm" onClick={() => void window.studio.installUpdate()}>Install and restart</Button>}
        {status.phase === 'available' && <Button className="rounded-none" size="sm" variant="outline" onClick={() => setPostponedVersion(status.version)}>Later</Button>}
      </div>
    </div>
  )
}
