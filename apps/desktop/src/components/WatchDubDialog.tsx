import { useEffect, useRef, useState } from 'react'
import { Maximize, Play, X } from 'lucide-react'
import type { DubPack, DubbingProject, ExportOptions } from '@studio/shared'
import { Button } from '@/components/ui/button'
import { useBackingTrackPlayback } from '@/hooks/useBackingTrackPlayback'

export function WatchDubDialog({
  project,
  pack,
  open,
  onClose,
  fastMode,
}: {
  project: DubbingProject
  pack: DubPack
  open: boolean
  onClose: () => void
  fastMode: boolean
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [backingVolume, setBackingVolume] = useState(100)
  const [backingAsset, setBackingAsset] = useState<{
    packId: string
    ref: string
    url: string
  } | null>(null)
  const backingUrl =
    backingAsset?.packId === pack.id &&
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
    window.studio.getBackingTrackBytes(pack.id).then(
      (bytes) => {
        const url = URL.createObjectURL(
          new Blob([new Uint8Array(bytes)], { type: 'audio/mp4' }),
        )
        if (active) {
          objectUrl = url
          setBackingAsset({ packId: pack.id, ref, url })
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
  }, [pack.id, pack.backingTrackRef])

  useEffect(() => {
    if (!open) return
    return window.studio.onExportProgress((update) => {
      if (update.projectId !== project.id) return
      setProgress(update.percent)
      setMessage(update.message)
    })
  }, [open, project.id])

  async function renderPreview() {
    videoRef.current?.pause()
    backingAudioRef.current?.pause()
    setBusy(true)
    setError(null)
    setProgress(0)
    setMessage('Rendering dub preview…')
    try {
      setPreviewUrl(
        await window.studio.renderDubPreview(project.id, {
          ...options,
          useBackingTrack: false,
        }),
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function exportVideo() {
    setBusy(true)
    setError(null)
    try {
      const result = await window.studio.exportProject(project.id, {
        ...options,
        fastMode: false,
      })
      if (result) setMessage(`Exported to ${result.outputPath}`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function fullscreenVideo() {
    const video = videoRef.current
    if (!video) return
    try {
      await video.requestFullscreen()
      setError(null)
    } catch (reason) {
      setError(
        reason instanceof Error
          ? `Could not open the video fullscreen: ${reason.message}`
          : 'Could not open the video fullscreen.',
      )
    }
  }

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void renderPreview(), 0)
    return () => window.clearTimeout(timer)
    // Start one render per opening; further changes use the Render again button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-label="Watch dub"
      onClose={onClose}
      className="watch-dub-dialog rounded-2xl border border-border bg-card p-5 text-foreground"
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
          onClick={onClose}
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
          {pack.backingTrackRef
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
          onClick={() => {
            if (videoRef.current) {
              videoRef.current.currentTime = 0
              void videoRef.current.play()
            }
          }}
          disabled={!previewUrl}
        >
          <Play aria-hidden="true" /> Replay
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void fullscreenVideo()}
          disabled={busy || !previewUrl}
          aria-label="Fullscreen video"
        >
          <Maximize aria-hidden="true" /> Fullscreen
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void renderPreview()}
          disabled={busy}
        >
          Refresh preview
        </Button>
        <Button size="sm" onClick={() => void exportVideo()} disabled={busy}>
          Export video
        </Button>
      </div>
    </dialog>
  )
}
