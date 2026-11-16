import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { DubPack, DubbingProject, ExportOptions } from '@studio/shared'
import { Button } from '@/components/ui/button'
import { useBackingTrackPlayback } from '@/hooks/useBackingTrackPlayback'

export function WatchDubDialog({
  project,
  pack,
  open,
  onClose,
  fastMode,
  mode = 'single',
  contentVersion,
  completedLines,
  totalLines,
}: {
  project: DubbingProject
  pack: DubPack
  open: boolean
  onClose: () => void
  fastMode: boolean
  mode?: 'single' | 'room'
  contentVersion?: string
  completedLines?: number
  totalLines?: number
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const operationRef = useRef(0)
  const closeRequestedRef = useRef(false)
  const [backingVolume, setBackingVolume] = useState(100)
  const [backingAsset, setBackingAsset] = useState<{
    key: string
    ref: string
    url: string
  } | null>(null)
  const backingKey = mode === 'room' ? project.id : pack.id
  const backingUrl =
    backingAsset?.key === backingKey &&
    backingAsset.ref === pack.backingTrackRef
      ? backingAsset.url
      : null
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { backingAudioRef, syncBacking } = useBackingTrackPlayback(
    backingUrl,
    backingVolume,
    videoRef,
    setError,
    open,
  )
  const options: ExportOptions = {
    useBackingTrack: Boolean(pack.backingTrackRef),
    requireComplete: false,
    backingVolume: backingVolume / 100,
    fastMode,
  }
  const cancelRender = () =>
    mode === 'room'
      ? window.studio.roomCancelRender()
      : window.studio.cancelExport(project.id)
  const close = () => {
    if (closeRequestedRef.current) return
    closeRequestedRef.current = true
    operationRef.current += 1
    void cancelRender()
    onClose()
  }

  useEffect(() => {
    if (open) closeRequestedRef.current = false
    return () => {
      if (open && !closeRequestedRef.current) {
        operationRef.current += 1
        void cancelRender()
      }
    }
    // Cancellation is tied to this opening, including parent unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, project.id])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open) {
      if (!dialog.open) {
        if (dialog.showModal) dialog.showModal()
        else dialog.setAttribute('open', '')
      }
    } else {
      videoRef.current?.pause()
      backingAudioRef.current?.pause()
      if (dialog.close && dialog.open) dialog.close()
      else dialog.removeAttribute('open')
    }
  }, [open, backingAudioRef])

  useEffect(() => {
    const ref = pack.backingTrackRef
    if (!ref) return
    let active = true
    let objectUrl: string | null = null
    const bytesPromise =
      mode === 'room'
        ? window.studio.roomGetBackingTrackBytes()
        : window.studio.getBackingTrackBytes(pack.id)
    bytesPromise.then(
      (bytes) => {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: 'audio/mp4' }),
        )
        if (active) {
          objectUrl = url
          setBackingAsset({ key: backingKey, ref, url })
        } else URL.revokeObjectURL(url)
      },
      (reason) => {
        if (active)
          setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [backingKey, mode, pack.id, pack.backingTrackRef])

  useEffect(() => {
    if (!open) return
    const subscribe =
      mode === 'room'
        ? window.studio.onRoomRenderProgress
        : window.studio.onExportProgress
    return subscribe((update) => {
      if (update.projectId !== project.id) return
      setProgress(update.percent)
      setMessage(update.message)
    })
  }, [open, project.id, mode])

  async function renderPreview() {
    const operation = ++operationRef.current
    videoRef.current?.pause()
    backingAudioRef.current?.pause()
    setBusy(true)
    setError(null)
    setProgress(0)
    setMessage('Rendering dub preview…')
    try {
      const url =
        mode === 'room'
          ? await window.studio.roomRenderPreview()
          : await window.studio.renderDubPreview(project.id, {
              ...options,
              useBackingTrack: false,
            })
      if (operation === operationRef.current) setPreviewUrl(url)
    } catch (reason) {
      if (operation === operationRef.current)
        setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (operation === operationRef.current) setBusy(false)
    }
  }

  async function exportVideo() {
    const operation = ++operationRef.current
    setBusy(true)
    setError(null)
    try {
      const result =
        mode === 'room'
          ? await window.studio.roomExport({ ...options, fastMode: false })
          : await window.studio.exportProject(project.id, {
              ...options,
              fastMode: false,
            })
      if (result && operation === operationRef.current)
        setMessage(`Exported to ${result.outputPath}`)
    } catch (reason) {
      if (operation === operationRef.current)
        setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (operation === operationRef.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void renderPreview(), 0)
    return () => window.clearTimeout(timer)
    // Start one render per opening; further changes use the Render again button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contentVersion])

  return (
    <dialog
      ref={dialogRef}
      aria-label="Watch dub"
      onClose={close}
      className="watch-dub-dialog border border-border bg-card p-5 text-foreground"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase text-primary">Final cut</p>
          <h2 className="mt-1 text-xl font-black uppercase">
            {pack.metadata.title}
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={close}
          aria-label="Close watch dub"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-5 aspect-video overflow-hidden rounded bg-black">
        {previewUrl && !busy ? (
          <video
            ref={videoRef}
            src={previewUrl}
            controls
            playsInline
            className="h-full w-full object-contain"
            onPlaying={(event) => syncBacking(event.currentTarget)}
            onWaiting={() => backingAudioRef.current?.pause()}
            onPause={() => backingAudioRef.current?.pause()}
            onEnded={() => backingAudioRef.current?.pause()}
            onSeeking={(event) => {
              if (backingAudioRef.current)
                backingAudioRef.current.currentTime =
                  event.currentTarget.currentTime
            }}
            onRateChange={(event) => {
              if (backingAudioRef.current)
                backingAudioRef.current.playbackRate =
                  event.currentTarget.playbackRate
            }}
            onTimeUpdate={(event) => {
              const backing = backingAudioRef.current
              if (
                backing &&
                Math.abs(
                  backing.currentTime - event.currentTarget.currentTime,
                ) > 0.2
              )
                backing.currentTime = event.currentTarget.currentTime
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {busy ? `${message} ${progress}%` : (error ?? 'Preparing preview…')}
          </div>
        )}
      </div>
      {backingUrl && (
        <audio
          key={backingUrl}
          ref={backingAudioRef}
          src={backingUrl}
          preload="auto"
        />
      )}
      {busy && (
        <progress
          value={progress}
          max={100}
          className="dub-render-progress mt-3 block h-1.5 w-full overflow-hidden rounded accent-primary"
        />
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="mr-auto text-xs text-muted-foreground">
          {completedLines !== undefined && totalLines !== undefined
            ? `${completedLines} of ${totalLines} lines recorded. Missing lines play silently.`
            : pack.backingTrackRef
              ? 'Your takes are mixed over the pack backing track.'
              : 'Your takes are mixed with silent gaps.'}
        </p>
        {pack.backingTrackRef && (
          <label className="flex items-center gap-2 text-xs">
            Backing track{' '}
            <input
              aria-label="Backing track volume"
              type="range"
              min="0"
              max="200"
              step="5"
              value={backingVolume}
              onChange={(event) => setBackingVolume(Number(event.target.value))}
              className="w-28 accent-primary"
            />{' '}
            {backingVolume}%
          </label>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void renderPreview()}
          disabled={busy}
        >
          Re-render
        </Button>
        <Button size="sm" onClick={() => void exportVideo()} disabled={busy}>
          Export video
        </Button>
      </div>
    </dialog>
  )
}
