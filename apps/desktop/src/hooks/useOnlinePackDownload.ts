import { createContext, useCallback, useEffect, useRef, useState } from 'react'
import type {
  OnlinePackDownloadDestination,
  OnlinePackDownloadEntry,
  OnlinePackDownloadsSnapshot,
  OnlinePackFile,
} from '@studio/shared'
import { reportError } from '@/lib/error-toast'

export function useOnlinePackDownload() {
  const [activity, setActivity] = useState<OnlinePackDownloadsSnapshot>({
    revision: -1,
    downloads: [],
    completedBytes: 0,
  })
  const [open, setOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const activeFiles = useRef(new Set<number>())

  const receiveSnapshot = useCallback((next: OnlinePackDownloadsSnapshot) => {
    setActivity((current) =>
      next.revision > current.revision ? next : current,
    )
  }, [])

  useEffect(() => {
    const unsubscribe =
      window.studio.onOnlinePackDownloadsChanged(receiveSnapshot)
    void window.studio
      .getOnlinePackDownloads()
      .then(receiveSnapshot, (reason) =>
        reportError(reason, 'Could not load downloads.'),
      )
    return unsubscribe
  }, [receiveSnapshot])

  async function refresh() {
    setRefreshing(true)
    try {
      receiveSnapshot(await window.studio.getOnlinePackDownloads())
    } catch (reason) {
      reportError(reason, 'Could not refresh downloads.')
    } finally {
      setRefreshing(false)
    }
  }

  async function start(
    packId: number,
    file: OnlinePackFile,
    destination: OnlinePackDownloadDestination,
  ) {
    if (activeFiles.current.has(file.id)) return
    activeFiles.current.add(file.id)
    setOpen(true)
    try {
      await window.studio.downloadOnlinePack(packId, file.id, destination)
    } catch (reason) {
      reportError(
        reason,
        'Could not download or import the GameBanana archive.',
      )
    } finally {
      activeFiles.current.delete(file.id)
    }
  }

  async function cancel({ packId, fileId }: OnlinePackDownloadEntry) {
    try {
      await window.studio.cancelOnlinePackDownload(packId, fileId)
    } catch (reason) {
      reportError(reason, 'Could not cancel the download.')
    }
  }

  async function clearFinished() {
    try {
      await window.studio.clearFinishedOnlinePackDownloads()
    } catch (reason) {
      reportError(reason, 'Could not clear finished downloads.')
    }
  }

  return {
    downloads: activity.downloads,
    completedBytes: activity.completedBytes,
    open,
    setOpen,
    refreshing,
    refresh,
    start,
    cancel,
    clearFinished,
  }
}

export type OnlinePackDownload = ReturnType<typeof useOnlinePackDownload>
export const OnlinePackDownloadsContext =
  createContext<OnlinePackDownload | null>(null)
