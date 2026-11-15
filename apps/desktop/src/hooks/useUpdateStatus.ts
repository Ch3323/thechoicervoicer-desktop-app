import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@studio/shared'

export function useUpdateStatus() {
  const [status, setStatus] = useState<UpdateStatus>({ phase: 'idle' })
  useEffect(() => {
    let active = true
    void window.studio.getUpdateStatus().then((value) => { if (active) setStatus(value) })
    const unsubscribe = window.studio.onUpdateStatus((value) => { if (active) setStatus(value) })
    return () => { active = false; unsubscribe() }
  }, [])
  return status
}
