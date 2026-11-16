import { playerError } from '@/lib/player-error'
import { useEffect, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Film,
  Mic,
  Play,
  Settings2,
  Square,
  Users,
  X,
} from 'lucide-react'
import type {
  Dialogue,
  DubbingProject,
  RecordingTake,
  VoiceEffect,
} from '@studio/shared'
import { dialogueMatchesRoles, RECORDING_LEAD_IN_SECONDS } from '@studio/shared'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  type CapturedTake,
  preferredRecordingMimeType,
  useMicrophoneRecorder,
} from '@/hooks/useMicrophoneRecorder'

export function RecordingStudio({
  project,
  dialogue,
  takes,
  onChanged,
  onHearClip,
  onStopClip,
  clipPlaying,
  canHearClip,
  maxDurationSeconds,
  onPreRollStart,
  onRecordingStart,
  onRecordingStop,
  onRecordingProgress,
  onRecordingSample,
  onPlayRecording,
  onChooseRoles,
  onWatchDub,
  onPreviousClip,
  onNextClip,
  clipPosition,
  clipCount,
  canPreviousClip = true,
  canNextClip = true,
  dubReady = false,
  voiceEffect,
  onSaveTake,
  onResolveTakeUrl,
  onResolveEffectTakeUrl,
}: {
  project: DubbingProject
  dialogue: Dialogue
  takes: RecordingTake[]
  onChanged: () => Promise<void>
  onHearClip: () => void
  onStopClip: () => void
  clipPlaying: boolean
  canHearClip: boolean
  maxDurationSeconds: number | null
  onPreRollStart?: () => void
  onRecordingStart: () => void
  onRecordingStop: (automatic: boolean) => void
  onRecordingProgress: (relativeSeconds: number) => void
  onRecordingSample: (elapsedSeconds: number, amplitude: number) => void
  onPlayRecording: (take: RecordingTake) => Promise<void>
  onChooseRoles?: () => void
  onWatchDub?: () => void
  onPreviousClip?: () => void
  onNextClip?: () => void
  clipPosition?: number
  clipCount?: number
  canPreviousClip?: boolean
  canNextClip?: boolean
  dubReady?: boolean
  voiceEffect?: VoiceEffect
  onSaveTake?: (input: {
    dialogueId: string
    mimeType: string
    durationSeconds: number
    offsetSeconds?: number
    bytes: Uint8Array
  }) => Promise<RecordingTake>
  onResolveTakeUrl?: (takeId: string) => Promise<string>
  onResolveEffectTakeUrl?: (
    dialogueId: string,
    takeId: string,
    effect: VoiceEffect,
  ) => Promise<string>
}) {
  const recorder = useMicrophoneRecorder()
  const settingsRef = useRef<HTMLDialogElement>(null)
  const recordingAudioRef = useRef<HTMLAudioElement>(null)
  const playbackFrameRef = useRef<number | null>(null)
  const [selectedTakeUrl, setSelectedTakeUrl] = useState<{
    id: string
    effectKey: string
    url: string
  } | null>(null)
  const [playingRecordingKey, setPlayingRecordingKey] = useState<string | null>(
    null,
  )
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const active = saving || recorder.status !== 'idle'
    void window.studio.setRecordingActivity?.(active)
    return () => { void window.studio.setRecordingActivity?.(false) }
  }, [saving, recorder.status])
  const [error, setError] = useState<string | null>(null)
  const assigned = dialogueMatchesRoles(dialogue, project.enabledCharacterIds)
  const selectedTake = takes.find((take) => take.selected)
  const effectKey = JSON.stringify(voiceEffect ?? null)
  const recordingKey = `${selectedTake?.id ?? ''}:${effectKey}`
  const recordingPlaying = playingRecordingKey === recordingKey
  const recordingUrl =
    selectedTakeUrl &&
    selectedTake &&
    selectedTakeUrl.id === selectedTake.id &&
    selectedTakeUrl.effectKey === effectKey
      ? selectedTakeUrl.url
      : null

  useEffect(() => {
    recordingAudioRef.current?.pause()
    stopRecordingPlayhead()
  }, [effectKey, selectedTake?.id])

  useEffect(() => {
    if (!selectedTake) return
    let active = true
    const processed = Boolean(
      voiceEffect &&
      (voiceEffect.preset !== 'original' ||
        [
          voiceEffect.pitch,
          voiceEffect.tone,
          voiceEffect.texture,
          voiceEffect.space,
          voiceEffect.echo,
          voiceEffect.mod,
        ].some((value) => value !== 0)),
    )
    const load = () => {
      const getUrl =
        processed && voiceEffect
          ? onResolveEffectTakeUrl
            ? onResolveEffectTakeUrl(dialogue.id, selectedTake.id, voiceEffect)
            : window.studio.getEffectTakeUrl(
                project.id,
                dialogue.id,
                selectedTake.id,
                voiceEffect,
              )
          : onResolveTakeUrl
            ? onResolveTakeUrl(selectedTake.id)
            : window.studio.getTakeUrl(selectedTake.id)
      getUrl.then(
        (url) => {
          if (active)
            setSelectedTakeUrl({ id: selectedTake.id, effectKey, url })
        },
        (reason) => {
          if (active) setError(String(reason))
        },
      )
    }
    const timer = processed ? window.setTimeout(load, 250) : null
    if (!processed) load()
    return () => {
      active = false
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [
    selectedTake,
    effectKey,
    project.id,
    dialogue.id,
    voiceEffect,
    onResolveTakeUrl,
    onResolveEffectTakeUrl,
  ])

  useEffect(
    () => () => {
      if (playbackFrameRef.current !== null)
        cancelAnimationFrame(playbackFrameRef.current)
    },
    [],
  )

  function stopRecordingPlayhead() {
    if (playbackFrameRef.current !== null)
      cancelAnimationFrame(playbackFrameRef.current)
    playbackFrameRef.current = null
  }

  function recordingPlaybackEnd(audio: HTMLAudioElement): number {
    const savedDuration = selectedTake?.durationSeconds ?? 0
    return Number.isFinite(audio.duration) && audio.duration > 0
      ? Math.min(savedDuration, audio.duration)
      : savedDuration
  }

  function recordingTimelinePosition(
    audio: HTMLAudioElement,
    finished = false,
  ): number {
    if (!selectedTake) return 0
    const playbackEnd = recordingPlaybackEnd(audio)
    const takeEnd = selectedTake.offsetSeconds + playbackEnd
    const guideEnd = maxDurationSeconds
    const tolerance = guideEnd
      ? Math.min(0.25, Math.max(0.1, guideEnd * 0.1))
      : 0
    const visualEnd =
      guideEnd && Math.abs(takeEnd - guideEnd) <= tolerance ? guideEnd : takeEnd
    const progress = finished
      ? 1
      : playbackEnd > 0
        ? Math.min(1, Math.max(0, audio.currentTime / playbackEnd))
        : 1
    return (
      selectedTake.offsetSeconds +
      (visualEnd - selectedTake.offsetSeconds) * progress
    )
  }

  function finishRecordingPlayback() {
    const audio = recordingAudioRef.current
    if (!audio || !selectedTake) return
    stopRecordingPlayhead()
    audio.pause()
    setPlayingRecordingKey(null)
    onStopClip()
    onRecordingProgress(recordingTimelinePosition(audio, true))
  }

  function startRecordingPlayhead() {
    stopRecordingPlayhead()
    const frame = () => {
      const audio = recordingAudioRef.current
      if (!audio || audio.paused) {
        playbackFrameRef.current = null
        return
      }
      const end = recordingPlaybackEnd(audio)
      if (audio.currentTime >= end) {
        finishRecordingPlayback()
        return
      }
      onRecordingProgress(recordingTimelinePosition(audio))
      playbackFrameRef.current = requestAnimationFrame(frame)
    }
    playbackFrameRef.current = requestAnimationFrame(frame)
  }

  function openSettings() {
    const dialog = settingsRef.current
    if (!dialog) return
    if (dialog.showModal) dialog.showModal()
    else dialog.setAttribute('open', '')
    dialog.focus()
  }

  function closeSettings() {
    recorder.stopTest()
    const dialog = settingsRef.current
    if (!dialog) return
    if (dialog.close) dialog.close()
    else dialog.removeAttribute('open')
  }

  function playRecording() {
    const audio = recordingAudioRef.current
    if (!audio || !selectedTake) return
    if (!audio.paused) {
      audio.pause()
      onStopClip()
      return
    }
    audio.currentTime = Math.max(
      0,
      -(dialogue.timestampSeconds + selectedTake.offsetSeconds),
    )
    onRecordingProgress(recordingTimelinePosition(audio))
    void Promise.all([onPlayRecording(selectedTake), audio.play()]).catch(
      (reason) => {
        audio.pause()
        onStopClip()
        setError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }

  function hearOriginalClip() {
    recordingAudioRef.current?.pause()
    onHearClip()
  }

  async function saveCaptured(take: CapturedTake) {
    setSaving(true)
    setError(null)
    try {
      const input = {
        dialogueId: dialogue.id,
        mimeType: take.mimeType,
        durationSeconds: take.durationSeconds,
        offsetSeconds: 0,
        bytes: new Uint8Array(await take.blob.arrayBuffer()),
      }
      if (onSaveTake) await onSaveTake(input)
      else await window.studio.saveTake({ ...input, projectId: project.id })
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  function startRecording() {
    onStopClip()
    recordingAudioRef.current?.pause()
    void recorder.start(
      maxDurationSeconds ?? 0,
      (take) => void saveCaptured(take),
      onRecordingStart,
      onRecordingStop,
      onRecordingSample,
      RECORDING_LEAD_IN_SECONDS,
      onPreRollStart,
    )
  }

  return (
    <section
      aria-label="Recording studio"
      className="rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2>On clip</h2>
        </div>
        {clipPosition && clipCount && (
          <span className="text-2xl font-black text-primary">
            {String(clipPosition).padStart(2, '0')}{' '}
            <span className="text-sm text-muted-foreground">/ {clipCount}</span>
          </span>
        )}
      </div>
      <div className="rail-controls mt-5 flex flex-col gap-2.5 [&_button]:w-full">
        <Button
          variant={clipPlaying ? 'secondary' : 'outline'}
          className="rail-button"
          onClick={hearOriginalClip}
          disabled={
            !canHearClip ||
            recorder.status === 'recording' ||
            recorder.status === 'preroll'
          }
        >
          {clipPlaying ? (
            <Square aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
          {clipPlaying ? 'Playing · Stop' : 'Hear clip'}
        </Button>
        {recorder.status === 'recording' || recorder.status === 'preroll' ? (
          <Button
            className="rail-button rail-button-record"
            onClick={recorder.stop}
          >
            <Square aria-hidden="true" />
            {recorder.status === 'preroll'
              ? 'Cancel recording'
              : 'Stop recording'}
          </Button>
        ) : (
          <Button
            className="rail-button rail-button-record"
            onClick={startRecording}
            disabled={
              !assigned ||
              recorder.status !== 'idle' ||
              saving ||
              !maxDurationSeconds
            }
          >
            <Mic aria-hidden="true" />{' '}
            {takes.length > 0 ? 'Record again' : 'Start recording'}
          </Button>
        )}
        <Button
          variant="outline"
          className="rail-button"
          onClick={playRecording}
          disabled={
            !recordingUrl ||
            recorder.status === 'recording' ||
            recorder.status === 'preroll'
          }
        >
          {recordingPlaying ? (
            <Square aria-hidden="true" />
          ) : (
            <Play aria-hidden="true" />
          )}
          {recordingPlaying ? 'Stop playback' : 'Play recording'}
        </Button>
        {onPreviousClip && onNextClip && (
          <div className="grid grid-cols-[46px_1fr] gap-2.5">
            <Button
              variant="outline"
              className="rail-button"
              onClick={onPreviousClip}
              aria-label="Previous clip"
              disabled={
                !canPreviousClip || recorder.status !== 'idle' || saving
              }
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              variant="outline"
              className="rail-button"
              onClick={onNextClip}
              disabled={!canNextClip || recorder.status !== 'idle' || saving}
            >
              Next clip <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        )}
        {onWatchDub && (
          <Button
            variant="secondary"
            onClick={onWatchDub}
            disabled={recorder.status !== 'idle'}
            className={`rail-button rail-button-watch${dubReady ? ' watch-ready' : ''}`}
          >
            <Film aria-hidden="true" /> Watch dub
          </Button>
        )}
        {onChooseRoles && (
          <Button
            className="rail-button"
            variant="secondary"
            onClick={onChooseRoles}
            disabled={recorder.status !== 'idle'}
          >
            <Users aria-hidden="true" /> Choose roles
          </Button>
        )}
        <Button
          variant="outline"
          className="rail-button"
          onClick={openSettings}
          disabled={recorder.status !== 'idle'}
          aria-label="Microphone settings"
        >
          <Settings2 aria-hidden="true" /> Mic settings
        </Button>
      </div>

      <dialog
        ref={settingsRef}
        tabIndex={-1}
        aria-label="Microphone settings"
        className="microphone-dialog rounded-2xl border border-border bg-card p-0 text-foreground"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h3 className="font-semibold">Microphone settings</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={closeSettings}
            aria-label="Close microphone settings"
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-sm text-muted-foreground">
            Choose your recording input.
          </p>
          <label className="block text-xs text-muted-foreground">
            Input device
            <select
              value={recorder.deviceId}
              onChange={(event) => recorder.setDeviceId(event.target.value)}
              disabled={recorder.status !== 'idle'}
              className="mt-2 w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground"
            >
              <option value="">System default</option>
              {recorder.deviceId &&
                !recorder.devices.some(
                  (device) => device.deviceId === recorder.deviceId,
                ) && (
                  <option value={recorder.deviceId}>
                    Previously selected microphone (unavailable)
                  </option>
                )}
              {recorder.devices
                .filter((device) => device.deviceId)
                .map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
            </select>
          </label>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => void recorder.refreshDevices()}
          >
            Refresh inputs
          </Button>
          <Button
            className="w-full"
            onClick={() =>
              recorder.testing ? recorder.stopTest() : void recorder.startTest()
            }
            disabled={recorder.status !== 'idle'}
          >
            {recorder.testing
              ? 'Stop microphone test'
              : 'Troubleshoot microphone'}
          </Button>
          {recorder.testing && (
            <div>
              <p className="text-xs text-muted-foreground">
                Speak into your microphone
              </p>
              <div className="mt-2 h-2 rounded bg-secondary">
                <div
                  className="h-full rounded bg-primary"
                  style={{ width: `${Math.round(recorder.testLevel * 100)}%` }}
                />
              </div>
            </div>
          )}
          <label className="block text-xs text-muted-foreground">
            Microphone volume · {recorder.inputVolume}%
            <input
              type="range"
              min="25"
              max="1200"
              step="25"
              value={recorder.inputVolume}
              onChange={(event) =>
                recorder.setInputVolume(Number(event.target.value))
              }
              className="mt-3 w-full accent-primary"
            />
            <span className="mt-1 flex justify-between">
              <span>25%</span>
              <button
                type="button"
                onClick={() => recorder.setInputVolume(100)}
                className="text-primary"
              >
                Reset to 100%
              </button>
              <span>1200%</span>
            </span>
          </label>
          <div className="border-t border-border pt-4">
            <h4 className="mb-3 text-xs font-bold uppercase text-muted-foreground">
              Microphone processing
            </h4>
            {(
              [
                [
                  'Automatic volume',
                  recorder.automaticVolume,
                  recorder.setAutomaticVolume,
                ],
                [
                  'Noise reduction',
                  recorder.noiseReduction,
                  recorder.setNoiseReduction,
                ],
                [
                  'Echo cancellation',
                  recorder.echoCancellation,
                  recorder.setEchoCancellation,
                ],
                [
                  'Voice isolation',
                  recorder.voiceIsolation,
                  recorder.setVoiceIsolation,
                ],
              ] as const
            ).map(([label, checked, change]) => (
              <div
                key={label}
                className="flex items-center justify-between border-b border-border py-3 text-sm"
              >
                <span>{label}</span>
                <Switch
                  checked={checked}
                  onCheckedChange={change}
                  label={label}
                  disabled={recorder.status !== 'idle' || recorder.testing}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Recording format:{' '}
            {preferredRecordingMimeType() ??
              'Browser default, detected on capture'}
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={closeSettings}>
              Done
            </Button>
          </div>
        </div>
      </dialog>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {recorder.status === 'requesting' && (
          <span className="text-sm text-muted-foreground">
            Waiting for microphone…
          </span>
        )}
        {recorder.status === 'processing' && (
          <span className="text-sm text-muted-foreground">
            Finishing recording…
          </span>
        )}
        {saving && (
          <span className="text-sm text-primary">Saving recording…</span>
        )}
        {recorder.status === 'recording' && (
          <span className="flex items-center gap-2 text-sm text-primary">
            <span className="size-2 animate-pulse rounded-full bg-red-400" />{' '}
            Recording · level {Math.round(recorder.level * 100)}%
          </span>
        )}
      </div>
      {!maxDurationSeconds && (
        <p className="mt-3 text-xs text-muted-foreground">
          Preparing the video and source clip length before recording…
        </p>
      )}
      {selectedTakeUrl && (
        <audio
          ref={recordingAudioRef}
          src={selectedTakeUrl.url}
          onPlay={() => setPlayingRecordingKey(recordingKey)}
          onPlaying={startRecordingPlayhead}
          onPause={() => {
            stopRecordingPlayhead()
            setPlayingRecordingKey(null)
          }}
          onEnded={finishRecordingPlayback}
          onTimeUpdate={(event) => {
            if (!selectedTake) return
            const end = recordingPlaybackEnd(event.currentTarget)
            if (event.currentTarget.currentTime >= end)
              finishRecordingPlayback()
            else
              onRecordingProgress(
                recordingTimelinePosition(event.currentTarget),
              )
          }}
        />
      )}
      {(recorder.error || error) && (
        <p role="alert" className="mt-4 text-sm text-red-300">
          {playerError(recorder.error || error)}
        </p>
      )}
    </section>
  )
}
