import { reportError } from '@/lib/error-toast'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  buildAudioTimeline,
  type DubPack,
  type DubbingProject,
  type ExportOptions,
  type RecordingTake,
} from '@studio/shared'
import { Button } from '@/components/ui/button'
import { useBackingTrackPlayback } from '@/hooks/useBackingTrackPlayback'
import { useDubbingTrackVolume } from '@/hooks/useDubbingTrackVolume'

export function WatchDubDialog({
  project,
  pack,
  takes,
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
  takes: readonly RecordingTake[]
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
  const takeAudioRefs = useRef(new Map<string, HTMLAudioElement>())
  const takeObjectUrlsRef = useRef<string[]>([])
  const operationRef = useRef(0)
  const closeRequestedRef = useRef(false)
  const [backingVolume, setBackingVolume] = useState(100)
  const [dubbingVolume, setDubbingVolume] = useState(100)
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
  const [takeUrls, setTakeUrls] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [previewUnavailable, setPreviewUnavailable] = useState(false)
  const timeline = useMemo(
    () => buildAudioTimeline(pack, project, takes),
    [pack, project, takes],
  )
  const placements = timeline.placements
  const { backingAudioRef, syncBacking, enableBoost } = useBackingTrackPlayback(
    backingUrl,
    backingVolume,
    videoRef,
    open,
  )
  const {
    attachAudio: attachDubbingAudio,
    enableBoost: enableDubbingBoost,
    contextRef: dubbingContextRef,
  } = useDubbingTrackVolume(takeAudioRefs, dubbingVolume)
  const options: ExportOptions = {
    useBackingTrack: Boolean(pack.backingTrackRef),
    requireComplete: false,
    backingVolume: backingVolume / 100,
    dubbingVolume: dubbingVolume / 100,
    fastMode,
  }
  const cancelExport = () =>
    mode === 'room'
      ? window.studio.roomCancelRender()
      : window.studio.cancelExport(project.id)
  const close = () => {
    if (closeRequestedRef.current) return
    closeRequestedRef.current = true
    operationRef.current += 1
    videoRef.current?.pause()
    for (const audio of takeAudioRefs.current.values()) audio.pause()
    void cancelExport()
    onClose()
  }

  useEffect(() => {
    if (open) closeRequestedRef.current = false
    return () => {
      for (const url of takeObjectUrlsRef.current) URL.revokeObjectURL(url)
      takeObjectUrlsRef.current = []
      if (open && !closeRequestedRef.current) {
        operationRef.current += 1
        void cancelExport()
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
      dialog.focus()
    } else {
      videoRef.current?.pause()
      backingAudioRef.current?.pause()
      for (const audio of takeAudioRefs.current.values()) audio.pause()
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
        if (active) reportError(reason, 'Backing audio is unavailable.')
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

  const syncTakes = useCallback(
    (video: HTMLVideoElement) => {
      if (dubbingVolume > 100 && dubbingContextRef.current?.state !== 'running')
        enableDubbingBoost()
      for (const placement of placements) {
        const audio = takeAudioRefs.current.get(placement.takeId)
        if (!audio) continue
        const position =
          video.currentTime -
          placement.startSeconds +
          placement.trimStartSeconds
        const active =
          position >= placement.trimStartSeconds &&
          position < placement.durationSeconds &&
          !video.paused &&
          !video.seeking
        if (!active) {
          audio.pause()
          continue
        }
        audio.playbackRate = video.playbackRate
        if (Math.abs(audio.currentTime - position) > 0.08)
          audio.currentTime = position
        if (audio.paused) {
          void audio
            .play()
            .catch((reason) => reportError(reason, 'A dubbed take could not be played.'))
        }
      }
    },
    [dubbingVolume, dubbingContextRef, enableDubbingBoost, placements],
  )

  async function preparePreview() {
    const operation = ++operationRef.current
    videoRef.current?.pause()
    backingAudioRef.current?.pause()
    for (const audio of takeAudioRefs.current.values()) audio.pause()
    setBusy(true)
    setPreviewUnavailable(false)
    setPreviewUrl(null)
    setTakeUrls({})
    for (const url of takeObjectUrlsRef.current) URL.revokeObjectURL(url)
    takeObjectUrlsRef.current = []
    setProgress(0)
    setMessage('Preparing dub preview…')
    try {
      const [url, sources] = await Promise.all([
        mode === 'room'
          ? window.studio.roomGetPreviewUrl()
          : window.studio.getPreviewUrl(pack.id),
        Promise.all(
          placements.map(async (placement) => {
            const effect = project.voiceEffects?.[placement.dialogueId]
            const audio = await window.studio.getPreviewTakeAudio(
              mode,
              project.id,
              placement.dialogueId,
              placement.takeId,
              effect,
              ...(placement.gainDb !== 0 ? [placement.gainDb] : []),
            )
            return [placement.takeId, audio] as const
          }),
        ),
      ])
      const urls = sources.map(
        ([takeId, audio]) =>
          [
            takeId,
            URL.createObjectURL(
              new Blob([new Uint8Array(audio.bytes)], {
                type: audio.mimeType,
              }),
            ),
          ] as const,
      )
      if (operation === operationRef.current) {
        takeObjectUrlsRef.current = urls.map(([, source]) => source)
        setTakeUrls(Object.fromEntries(urls))
        setPreviewUrl(url)
      } else for (const [, source] of urls) URL.revokeObjectURL(source)
    } catch (reason) {
      if (operation === operationRef.current) {
        setPreviewUnavailable(true)
        reportError(reason, 'The dub preview is unavailable.')
      }
    } finally {
      if (operation === operationRef.current) setBusy(false)
    }
  }

  async function exportVideo() {
    const operation = ++operationRef.current
    setBusy(true)
    try {
      const result =
        mode === 'room'
          ? await window.studio.roomExport(options)
          : await window.studio.exportProject(project.id, options)
      if (result && operation === operationRef.current)
        setMessage(
          result.destination === 'drive'
            ? 'Uploaded to Google Drive'
            : `Exported to ${result.outputPath}`,
        )
    } catch (reason) {
      if (operation === operationRef.current) reportError(reason, 'Could not export the video.')
    } finally {
      if (operation === operationRef.current) setBusy(false)
    }
  }

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void preparePreview(), 0)
    return () => window.clearTimeout(timer)
    // Refresh the media sources when this opening or its content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contentVersion])

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      aria-label="Watch dub"
      onClose={close}
      className="watch-dub-dialog border border-border bg-card p-4 text-foreground"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <span className="shrink-0 text-xs font-bold uppercase text-primary">
            Final cut
          </span>
          <h2
            className="truncate text-lg font-black uppercase"
            title={pack.metadata.title}
          >
            {pack.metadata.title}
          </h2>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="size-8 shrink-0 p-0"
          onClick={close}
          aria-label="Close watch dub"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="mt-3 aspect-video overflow-hidden rounded bg-black">
        {previewUrl ? (
          <video
            ref={videoRef}
            src={previewUrl}
            onError={() => reportError('The dub preview video could not be played.')}
            muted
            controls
            playsInline
            className="h-full w-full object-contain"
            onPlaying={(event) => {
              syncBacking(event.currentTarget)
              syncTakes(event.currentTarget)
            }}
            onWaiting={() => {
              backingAudioRef.current?.pause()
              for (const audio of takeAudioRefs.current.values()) audio.pause()
            }}
            onPause={() => {
              backingAudioRef.current?.pause()
              for (const audio of takeAudioRefs.current.values()) audio.pause()
            }}
            onEnded={() => {
              backingAudioRef.current?.pause()
              for (const audio of takeAudioRefs.current.values()) audio.pause()
            }}
            onSeeking={(event) => {
              for (const audio of takeAudioRefs.current.values()) audio.pause()
              if (backingAudioRef.current)
                backingAudioRef.current.currentTime =
                  event.currentTarget.currentTime
            }}
            onSeeked={(event) => {
              syncBacking(event.currentTarget)
              syncTakes(event.currentTarget)
            }}
            onRateChange={(event) => {
              syncBacking(event.currentTarget)
              syncTakes(event.currentTarget)
            }}
            onTimeUpdate={(event) => {
              syncBacking(event.currentTarget)
              syncTakes(event.currentTarget)
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {busy ? `${message} ${progress}%` : previewUnavailable ? 'Preview unavailable' : 'Preparing preview…'}
          </div>
        )}
      </div>
      {backingUrl && (
        <audio
          key={backingUrl}
          ref={backingAudioRef}
          onError={() => reportError('The backing audio could not be played.')}
          src={backingUrl}
          preload="auto"
        />
      )}
      {placements.map((placement) => (
        <audio
          key={placement.takeId}
          onError={() => reportError('A dubbed take could not be played.')}
          ref={(element) => {
            if (element) {
              takeAudioRefs.current.set(placement.takeId, element)
              attachDubbingAudio(element)
              if (!dubbingContextRef.current)
                element.volume = Math.min(1, dubbingVolume / 100)
            } else takeAudioRefs.current.delete(placement.takeId)
          }}
          src={takeUrls[placement.takeId]}
          preload="none"
        />
      ))}
      {busy && (
        <progress
          value={progress}
          max={100}
          className="dub-render-progress mt-3 block h-1.5 w-full overflow-hidden rounded accent-primary"
        />
      )}
      {completedLines !== undefined && totalLines !== undefined && (
        <p className="mt-2 text-xs text-muted-foreground">
          {completedLines}/{totalLines} lines recorded
          {completedLines < totalLines ? ' · Missing lines play silently.' : ''}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {pack.backingTrackRef ? (
            <label className="flex items-center gap-1.5 text-xs">
              Backing{' '}
              <input
                aria-label="Backing track volume"
                type="range"
                min="0"
                max="200"
                step="5"
                value={backingVolume}
                onChange={(event) => {
                  const volume = Number(event.target.value)
                  if (volume > 100) enableBoost()
                  setBackingVolume(volume)
                }}
                className="w-24 accent-primary"
              />{' '}
              {backingVolume}%
            </label>
          ) : (
            <span className="text-xs text-muted-foreground">
              No backing track
            </span>
          )}
          <label className="flex items-center gap-1.5 text-xs">
            Dubbing{' '}
            <input
              aria-label="Dubbing track volume"
              type="range"
              min="0"
              max="200"
              step="5"
              value={dubbingVolume}
              onChange={(event) => {
                const volume = Number(event.target.value)
                if (volume > 100) enableDubbingBoost()
                setDubbingVolume(volume)
              }}
              className="w-24 accent-primary"
            />{' '}
            {dubbingVolume}%
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void preparePreview()}
            disabled={busy}
          >
            Refresh preview
          </Button>
          <Button size="sm" onClick={() => void exportVideo()} disabled={busy}>
            Export video
          </Button>
        </div>
      </div>
    </dialog>
  )
}
