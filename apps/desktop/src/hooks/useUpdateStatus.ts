import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@studio/shared'
import { reportError } from '@/lib/error-toast'

export async function runUpdateAction(action: () => Promise<void>) {
  try {
    await action()
  } catch (reason) {
    reportError(reason, 'Could not complete the update. Please try again.')
  }
}

export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle' })
  useEffect(() => {
    let active = true
    void window.studio.getUpdateStatus().then(
      (value) => { if (active) setStatus(value) },
      (reason) => { if (active) reportError(reason, 'Could not read the update status.') },
    )
    const unsubscribe = window.studio.onUpdateStatus((value) => { if (active) setStatus(value) })
    return () => { active = false; unsubscribe() }
  }, [])
  return status
}
