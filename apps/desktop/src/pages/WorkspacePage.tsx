import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ListFilter, X } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import {
  buildAudioTimeline,
  dialoguePreviewRange,
  dialogueMatchesRoles,
  RECORDING_LEAD_IN_SECONDS,
  RECORDING_TAIL_SECONDS,
  type DialoguePreviewRange,
  type DubPack,
  type DubbingProject,
  type RecordingTake,
  type VoiceEffect,
} from '@studio/shared'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { RecordingStudio } from '@/components/RecordingStudio'
import { OverlapWaveform } from '@/components/OverlapWaveform'
import { PackThumbnail } from '@/components/PackThumbnail'
import { WatchDubDialog } from '@/components/WatchDubDialog'
import { VoiceEffectsPanel } from '@/components/VoiceEffectsPanel'
import {
  appendLiveSample,
  newLiveTakeWaveform,
  type LiveTakeWaveform,
} from '@/lib/live-waveform'
import { formatCueTime } from '@/lib/format-cue-time'

const originalVoiceEffect: VoiceEffect = {
  preset: 'original',
  pitch: 0,
  tone: 0,
  texture: 0,
  space: 0,
  echo: 0,
  mod: 0,
}

export function WorkspacePage({
  embedded = false,
  activeProjectId,
}: {
  embedded?: boolean
  activeProjectId?: string
} = {}) {
  const { projectId: routeProjectId } = useParams()
  const projectId = activeProjectId ?? routeProjectId
  const MainElement = embedded ? 'div' : 'main'
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const rolesDialogRef = useRef<HTMLDialogElement>(null)
  const playheadFrameRef = useRef<number | null>(null)
  const recordingFrameRef = useRef<number | null>(null)
  const effectSaveRef = useRef<Promise<void>>(Promise.resolve())
  const previewRangeRef = useRef<DialoguePreviewRange | null>(null)
  const waveformDurationRef = useRef<{ ref: string; seconds: number } | null>(
    null,
  )
  const previewModeRef = useRef<'source' | 'capture' | 'take' | null>(null)
  const [project, setProject] = useState<DubbingProject | null>(null)
  const [pack, setPack] = useState<DubPack | null>(null)
  const [takes, setTakes] = useState<RecordingTake[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [audioAsset, setAudioAsset] = useState<{
    ref: string
    url: string
  } | null>(null)
  const [imageAsset, setImageAsset] = useState<{
    ref: string
    url: string
  } | null>(null)
  const [duration, setDuration] = useState(0)
  const [videoReady, setVideoReady] = useState(false)
  const [audioReady, setAudioReady] = useState(false)
  const [sampleDuration, setSampleDuration] = useState<{
    ref: string
    seconds: number
  } | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSeconds, setPlaybackSeconds] = useState(0)
  const [liveTake, setLiveTake] = useState<LiveTakeWaveform | null>(null)
  const [onlyMyRoles, setOnlyMyRoles] = useState(false)
  const [characterFilter, setCharacterFilter] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [watchOpen, setWatchOpen] = useState(false)
  const [playOriginalDuringRecording, setPlayOriginalDuringRecording] =
    useState(false)
  const [playClipVideo, setPlayClipVideo] = useState(true)
  const [fastMode, setFastMode] = useState(false)
  const [showClips, setShowClips] = useState(true)

  useEffect(() => {
    let active = true
    Promise.all([window.studio.listProjects(), window.studio.listPacks()]).then(
      ([projects, packs]) => {
        if (!active) return
        const foundProject = projects.find((item) => item.id === projectId)
        const foundPack = packs.find((item) => item.id === foundProject?.packId)
        if (!foundProject || !foundPack) {
          setError('Project or Dub Pack could not be found.')
          return
        }
        setProject(foundProject)
        setPack(foundPack)
        setSelectedId(foundPack.dialogues[0]?.id ?? null)
        window.studio.listTakes(foundProject.id).then(
          (items) => {
            if (active) setTakes(items)
          },
          (reason) => {
            if (active) setError(String(reason))
          },
        )
      },
      (reason) => {
        if (active) setError(String(reason))
      },
    )
    return () => {
      active = false
    }
  }, [projectId])

  useEffect(() => {
    if (!pack) return
    let active = true
    window.studio.getPreviewUrl(pack.id).then(
      (url) => {
        if (active) setPreviewUrl(url)
      },
      (reason) => {
        if (active) setPreviewError(String(reason))
      },
    )
    return () => {
      active = false
    }
  }, [pack])

  const selected = pack?.dialogues.find(
    (dialogue) => dialogue.id === selectedId,
  )
  const selectedPackIndex =
    pack?.dialogues.findIndex((dialogue) => dialogue.id === selectedId) ?? -1
  const previousAssigned =
    selectedPackIndex > 0
      ? pack?.dialogues
          .slice(0, selectedPackIndex)
          .reverse()
          .find(
            (dialogue) =>
              project &&
              dialogueMatchesRoles(dialogue, project.enabledCharacterIds) &&
              (!characterFilter ||
                dialogue.characterIds.includes(characterFilter)),
          )
      : undefined
  const nextAssigned = pack?.dialogues
    .slice(selectedPackIndex + 1)
    .find(
      (dialogue) =>
        project &&
        dialogueMatchesRoles(dialogue, project.enabledCharacterIds) &&
        (!characterFilter || dialogue.characterIds.includes(characterFilter)),
    )
  const previewRange = useMemo(
    () =>
      selected
        ? dialoguePreviewRange(
            selected,
            duration,
            sampleDuration?.ref === selected.sourceRef
              ? sampleDuration.seconds
              : undefined,
          )
        : null,
    [selected, duration, sampleDuration],
  )
  const handleSourceDuration = useCallback(
    (seconds: number) => {
      if (selected) {
        const value = { ref: selected.sourceRef, seconds }
        waveformDurationRef.current = value
        setSampleDuration(value)
      }
    },
    [selected],
  )

  useEffect(
    () => () => {
      if (playheadFrameRef.current !== null)
        cancelAnimationFrame(playheadFrameRef.current)
      if (recordingFrameRef.current !== null)
        cancelAnimationFrame(recordingFrameRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!previewModeRef.current) previewRangeRef.current = previewRange
    const video = videoRef.current
    if (
      !previewModeRef.current &&
      video &&
      previewRange &&
      video.currentTime > previewRange.endSeconds
    ) {
      video.pause()
      audioRef.current?.pause()
      video.currentTime = previewRange.endSeconds
      setIsPlaying(false)
    }
  }, [previewRange])
  useEffect(() => {
    if (!pack || !selected) return
    let active = true
    window.studio.getAssetUrl(pack.id, selected.sourceRef).then(
      (url) => {
        if (active) setAudioAsset({ ref: selected.sourceRef, url })
      },
      () => undefined,
    )
    if (selected.imageRef) {
      window.studio.getAssetUrl(pack.id, selected.imageRef).then(
        (url) => {
          if (active) setImageAsset({ ref: selected.imageRef!, url })
        },
        () => undefined,
      )
    }
    return () => {
      active = false
    }
  }, [pack, selected])

  const audioUrl =
    audioAsset && audioAsset.ref === selected?.sourceRef ? audioAsset.url : null
  const imageUrl =
    imageAsset && imageAsset.ref === selected?.imageRef ? imageAsset.url : null

  const visibleDialogues = useMemo(() => {
    if (!pack || !project) return []
    return pack.dialogues.filter((dialogue) =>
      characterFilter
        ? dialogue.characterIds.includes(characterFilter)
        : !onlyMyRoles ||
          dialogueMatchesRoles(dialogue, project.enabledCharacterIds),
    )
  }, [pack, project, onlyMyRoles, characterFilter])

  const timeline = useMemo(
    () => (pack && project ? buildAudioTimeline(pack, project, takes) : null),
    [pack, project, takes],
  )

  async function refreshTakes() {
    if (!project) return
    setTakes(await window.studio.listTakes(project.id))
    const refreshed = (await window.studio.listProjects()).find(
      (item) => item.id === project.id,
    )
    if (refreshed) setProject(refreshed)
  }

  function selectDialogue(id: string, seconds: number) {
    stopClip()
    const dialogue = pack?.dialogues.find((item) => item.id === id)
    if (dialogue) {
      if (dialogue.sourceRef !== selected?.sourceRef) setAudioReady(false)
      previewRangeRef.current = dialoguePreviewRange(
        dialogue,
        duration,
        sampleDuration?.ref === dialogue.sourceRef
          ? sampleDuration.seconds
          : undefined,
      )
    }
    setSelectedId(id)
    const video = videoRef.current
    if (video && video.readyState >= 1) {
      video.currentTime = seconds
      setPlaybackSeconds(seconds)
    }
  }

  function stopClip() {
    videoRef.current?.pause()
    audioRef.current?.pause()
    previewModeRef.current = null
    previewRangeRef.current = previewRange
    if (playheadFrameRef.current !== null)
      cancelAnimationFrame(playheadFrameRef.current)
    playheadFrameRef.current = null
    if (recordingFrameRef.current !== null)
      cancelAnimationFrame(recordingFrameRef.current)
    recordingFrameRef.current = null
    setIsPlaying(false)
  }

  function startPlayheadLoop() {
    if (playheadFrameRef.current !== null)
      cancelAnimationFrame(playheadFrameRef.current)
    const frame = () => {
      if (previewModeRef.current === 'source') {
        const audio = audioRef.current
        if (!audio || audio.paused) {
          playheadFrameRef.current = null
          return
        }
        const cue = previewRangeRef.current?.startSeconds ?? 0
        const end = previewRangeRef.current?.endSeconds ?? cue
        if (cue + audio.currentTime >= end) {
          finishSourceClip()
          return
        }
        setPlaybackSeconds(cue + audio.currentTime)
        playheadFrameRef.current = requestAnimationFrame(frame)
        return
      }
      const video = videoRef.current
      if (!video || video.paused) {
        playheadFrameRef.current = null
        return
      }
      setPlaybackSeconds(video.currentTime)
      playheadFrameRef.current = requestAnimationFrame(frame)
    }
    playheadFrameRef.current = requestAnimationFrame(frame)
  }

  function finishSourceClip() {
    if (previewModeRef.current !== 'source') return
    const end = previewRangeRef.current?.endSeconds
    stopClip()
    if (end !== undefined) setPlaybackSeconds(end)
  }

  function startRecordingPreRoll() {
    const video = videoRef.current
    if (!video || !selected) return
    previewModeRef.current = 'capture'
    setLiveTake(newLiveTakeWaveform(selected.id))
    audioRef.current?.pause()
    video.pause()
    video.currentTime = selected.timestampSeconds
    const cue = selected.timestampSeconds
    // The waveform pre-roll can start before video time zero.
    setPlaybackSeconds(cue - RECORDING_LEAD_IN_SECONDS)
    const startedAt = performance.now()
    const advance = () => {
      setPlaybackSeconds(
        cue -
          RECORDING_LEAD_IN_SECONDS +
          Math.min(
            RECORDING_LEAD_IN_SECONDS,
            (performance.now() - startedAt) / 1000,
          ),
      )
      recordingFrameRef.current = requestAnimationFrame(advance)
    }
    if (recordingFrameRef.current !== null)
      cancelAnimationFrame(recordingFrameRef.current)
    recordingFrameRef.current = requestAnimationFrame(advance)
  }

  function startRecordingPreview() {
    const video = videoRef.current
    if (!video || !selected) return
    if (recordingFrameRef.current !== null)
      cancelAnimationFrame(recordingFrameRef.current)
    recordingFrameRef.current = null
    previewModeRef.current = 'capture'
    const cue = selected.timestampSeconds
    const clipLength =
      sampleDuration?.ref === selected.sourceRef ? sampleDuration.seconds : 0
    previewRangeRef.current = {
      startSeconds: cue,
      endSeconds: Math.min(duration, cue + clipLength),
    }
    setPlaybackSeconds(cue)
    if (playOriginalDuringRecording && audioRef.current) {
      audioRef.current.currentTime = 0
      void audioRef.current
        .play()
        .catch((reason) =>
          setPreviewError(
            reason instanceof Error ? reason.message : String(reason),
          ),
        )
    }
    if (playClipVideo)
      void video
        .play()
        .catch((reason) =>
          setPreviewError(
            reason instanceof Error ? reason.message : String(reason),
          ),
        )
    const startedAt = performance.now()
    const advance = () => {
      setPlaybackSeconds(
        cue + Math.min(clipLength, (performance.now() - startedAt) / 1000),
      )
      recordingFrameRef.current = requestAnimationFrame(advance)
    }
    recordingFrameRef.current = requestAnimationFrame(advance)
  }

  function stopRecordingPreview(automatic: boolean) {
    if (recordingFrameRef.current !== null)
      cancelAnimationFrame(recordingFrameRef.current)
    recordingFrameRef.current = null
    stopClip()
    setLiveTake(null)
    if (automatic && selected) {
      const length =
        sampleDuration?.ref === selected.sourceRef ? sampleDuration.seconds : 0
      setPlaybackSeconds(selected.timestampSeconds + length)
    }
  }

  function sampleRecording(elapsedSeconds: number, amplitude: number) {
    if (!selected || sampleDuration?.ref !== selected.sourceRef) return
    setLiveTake((current) =>
      current?.dialogueId === selected.id
        ? appendLiveSample(
            current,
            elapsedSeconds + RECORDING_LEAD_IN_SECONDS,
            sampleDuration.seconds +
              RECORDING_LEAD_IN_SECONDS +
              RECORDING_TAIL_SECONDS,
            amplitude,
          )
        : current,
    )
  }

  function playTakePreview(take: RecordingTake): Promise<void> {
    const video = videoRef.current
    if (!video || !selected)
      return Promise.reject(new Error('Video preview is not ready.'))
    stopClip()
    const absoluteStart = selected.timestampSeconds + take.offsetSeconds
    const startSeconds = Math.max(0, absoluteStart)
    const remainingSeconds = Math.max(
      0,
      take.durationSeconds - Math.max(0, -absoluteStart),
    )
    if (remainingSeconds <= 0 || startSeconds >= duration)
      return Promise.reject(new Error('This take falls outside the video.'))
    previewModeRef.current = 'take'
    previewRangeRef.current = {
      startSeconds,
      endSeconds: Math.min(duration, startSeconds + remainingSeconds),
    }
    video.currentTime = startSeconds
    setPlaybackSeconds(startSeconds)
    setPreviewError(null)
    return video.play()
  }

  function hearClip() {
    if (isPlaying) {
      stopClip()
      return
    }
    const video = videoRef.current
    const audio = audioRef.current
    const range = previewRangeRef.current
    if (!video || !audio || !range || range.endSeconds <= range.startSeconds)
      return
    const sourceLength =
      selected && sampleDuration?.ref === selected.sourceRef
        ? sampleDuration.seconds
        : audio.duration
    const sourceEnd = range.startSeconds + sourceLength
    if (!Number.isFinite(sourceEnd) || sourceEnd <= range.startSeconds) return
    video.pause()
    audio.pause()
    video.currentTime = range.startSeconds
    audio.currentTime = 0
    previewRangeRef.current = { ...range, endSeconds: sourceEnd }
    previewModeRef.current = 'source'
    setPreviewError(null)
    setPlaybackSeconds(range.startSeconds)
    setIsPlaying(true)
    // Start both media elements directly in the user gesture. Muting the video
    // makes the source sample the only audible dialogue for this preview.
    void Promise.all([
      ...(playClipVideo ? [video.play()] : []),
      audio.play(),
    ]).then(
      () => {
        if (!playClipVideo) startPlayheadLoop()
      },
      (reason) => {
        stopClip()
        setPreviewError(
          reason instanceof Error
            ? reason.message
            : 'Unable to play this clip.',
        )
      },
    )
  }

  function updatePlayback(video: HTMLVideoElement) {
    if (previewModeRef.current === 'source') {
      const end = previewRangeRef.current?.endSeconds
      if (playClipVideo && end !== undefined && video.currentTime >= end) {
        video.pause()
        if (Math.abs(video.currentTime - end) > 0.02) video.currentTime = end
      }
      return
    }
    const range = previewRangeRef.current
    if (!range) return
    if (video.currentTime >= range.endSeconds) {
      video.pause()
      if (Math.abs(video.currentTime - range.endSeconds) > 0.02)
        video.currentTime = range.endSeconds
    } else if (video.currentTime < range.startSeconds) {
      video.currentTime = range.startSeconds
    }
    if (previewModeRef.current === null)
      setPlaybackSeconds(
        Math.max(
          range.startSeconds,
          Math.min(video.currentTime, range.endSeconds),
        ),
      )
  }

  async function toggleRole(id: string) {
    if (!project) return
    const next = project.enabledCharacterIds.includes(id)
      ? project.enabledCharacterIds.filter((item) => item !== id)
      : [...project.enabledCharacterIds, id]
    try {
      setProject(await window.studio.updateProjectRoles(project.id, next))
      if (characterFilter === id && !next.includes(id)) setCharacterFilter('')
      setError(null)
    } catch (reason) {
      setError(String(reason))
    }
  }

  async function changeVoiceEffect(effect: VoiceEffect) {
    if (!project || !selected) return
    if (previewModeRef.current === 'take') stopClip()
    const projectId = project.id
    const dialogueId = selected.id
    setProject((current) =>
      current
        ? {
            ...current,
            voiceEffects: { ...current.voiceEffects, [dialogueId]: effect },
          }
        : current,
    )
    const pending = effectSaveRef.current.then(() =>
      window.studio.updateVoiceEffect(projectId, dialogueId, effect),
    )
    effectSaveRef.current = pending.then(
      () => undefined,
      () => undefined,
    )
    try {
      await pending
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function openWatchDub() {
    await effectSaveRef.current
    setWatchOpen(true)
  }

  function openRoles() {
    const dialog = rolesDialogRef.current
    if (dialog?.showModal) dialog.showModal()
    else dialog?.setAttribute('open', '')
  }

  function closeRoles() {
    const dialog = rolesDialogRef.current
    if (dialog?.close) dialog.close()
    else dialog?.removeAttribute('open')
  }

  return (
    <div
      className={`studio-app workspace-page bg-background text-foreground ${embedded ? 'workspace-embedded' : 'min-h-screen'}`}
    >
      <div
        className={
          embedded
            ? 'workspace-embedded-inner'
            : 'mx-auto max-w-[1500px] px-5 py-5 sm:px-8'
        }
      >
        {!embedded && (
          <header className="flex items-center justify-between border-b border-border pb-5">
            <Button asChild variant="ghost" size="sm">
              <Link to="/projects">
                <ArrowLeft aria-hidden="true" /> RECORDINGS
              </Link>
            </Button>
            <span className="workspace-brand">
              CHOICER <strong>VOICER</strong> STUDIO <span>/ NOW DUBBING</span>
            </span>
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                Changes saved automatically
              </span>
            </div>
          </header>
        )}
        {error && (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200"
          >
            {error}
          </p>
        )}
        {!pack || !project ? (
          <p className="mt-12 text-muted-foreground">Loading project…</p>
        ) : (
          <MainElement className="workspace-main pt-8">
            <div className="mb-7">
              <p className="text-xs uppercase tracking-[0.18em] text-primary">
                VOICE PACK / RECORDING SESSION
              </p>
              <h1 className="mt-2 text-3xl font-semibold">
                {pack.metadata.title}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {pack.dialogues.length} dialogue instances ·{' '}
                {pack.characters.length} characters ·{' '}
                {timeline
                  ? timeline.requiredDialogueIds.length -
                    timeline.missingDialogueIds.length
                  : 0}
                /{timeline?.requiredDialogueIds.length ?? 0} assigned lines
                complete
              </p>
            </div>
            <div className="workspace-grid grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
              <div className="workspace-primary space-y-6">
                <section
                  aria-label="Video player"
                  className="workspace-monitor overflow-hidden rounded-2xl border border-border bg-black"
                >
                  <div className="relative aspect-video w-full bg-black">
                    {previewUrl ? (
                      <video
                        ref={videoRef}
                        className="absolute inset-0 h-full w-full object-contain"
                        src={previewUrl}
                        muted
                        playsInline
                        preload="metadata"
                        onLoadedMetadata={(event) => {
                          const video = event.currentTarget
                          setDuration(video.duration)
                          setVideoReady(true)
                          if (selected) {
                            previewRangeRef.current = dialoguePreviewRange(
                              selected,
                              video.duration,
                              sampleDuration?.ref === selected.sourceRef
                                ? sampleDuration.seconds
                                : undefined,
                            )
                            video.currentTime = selected.timestampSeconds
                            setPlaybackSeconds(selected.timestampSeconds)
                          }
                        }}
                        onTimeUpdate={(event) =>
                          updatePlayback(event.currentTarget)
                        }
                        onPlaying={(event) => {
                          const sourcePlaying =
                            previewModeRef.current === 'source'
                          setIsPlaying(sourcePlaying)
                          if (sourcePlaying) startPlayheadLoop()
                          const range = previewRangeRef.current
                          const audio = audioRef.current
                          if (sourcePlaying && range && audio) {
                            const elapsed = Math.max(
                              0,
                              event.currentTarget.currentTime -
                                range.startSeconds,
                            )
                            if (Math.abs(audio.currentTime - elapsed) > 0.2)
                              audio.currentTime = elapsed
                          }
                        }}
                        onPause={() => {
                          if (previewModeRef.current === 'source') return
                          if (playheadFrameRef.current !== null)
                            cancelAnimationFrame(playheadFrameRef.current)
                          playheadFrameRef.current = null
                          setIsPlaying(false)
                        }}
                        onEnded={() => {
                          if (
                            previewModeRef.current !== 'source' &&
                            previewModeRef.current !== 'take'
                          )
                            stopClip()
                        }}
                        onError={() => {
                          setVideoReady(false)
                          setPreviewError('Video preview could not be played.')
                        }}
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
                        {previewError ??
                          'Preparing an MP4 preview from the source OGV…'}
                      </div>
                    )}
                    {selected && (
                      <div className="pointer-events-none absolute left-4 top-4 z-10 rounded border border-white/25 bg-black/75 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-white">
                        <span className="mr-2 inline-block size-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
                        Cue{' '}
                        <span className="ml-2 text-amber-300">
                          {formatCueTime(playbackSeconds)}
                        </span>
                      </div>
                    )}
                    {selected && (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/75 to-transparent px-5 pb-6 pt-16 text-center">
                        <div className="flex items-center justify-center gap-2">
                          {selected.characterIds.map((id) => (
                            <span
                              key={id}
                              className="bg-primary px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-primary-foreground"
                            >
                              {pack.characters.find(
                                (character) => character.id === id,
                              )?.name ?? id}
                            </span>
                          ))}
                        </div>
                        <p className="mt-2 text-lg font-black text-white [text-shadow:0_2px_7px_#000,0_0_12px_#000] sm:text-2xl">
                          {selected.caption || selected.sourceRef}
                        </p>
                        {imageUrl && (
                          <img
                            src={imageUrl}
                            alt="Dialogue artwork"
                            className="absolute bottom-4 right-4 max-h-12 max-w-12 rounded border border-white/20 object-contain"
                          />
                        )}
                      </div>
                    )}
                  </div>
                  {audioUrl && (
                    <audio
                      ref={audioRef}
                      key={audioUrl}
                      src={audioUrl}
                      preload="auto"
                      onLoadedMetadata={(event) => {
                        if (
                          waveformDurationRef.current?.ref !==
                          selected!.sourceRef
                        )
                          setSampleDuration({
                            ref: selected!.sourceRef,
                            seconds: event.currentTarget.duration,
                          })
                        setAudioReady(true)
                      }}
                      onError={() => {
                        setAudioReady(false)
                        setPreviewError(
                          'Original dialogue audio could not be played.',
                        )
                      }}
                      onEnded={() => {
                        finishSourceClip()
                      }}
                      onPlaying={() => {
                        if (previewModeRef.current === 'source')
                          startPlayheadLoop()
                      }}
                      onTimeUpdate={(event) => {
                        if (previewModeRef.current !== 'source') return
                        const range = previewRangeRef.current
                        if (!range) return
                        if (
                          range.startSeconds +
                            event.currentTarget.currentTime >=
                          range.endSeconds
                        )
                          finishSourceClip()
                        else
                          setPlaybackSeconds(
                            range.startSeconds +
                              event.currentTarget.currentTime,
                          )
                      }}
                    />
                  )}
                  {previewError && previewUrl && (
                    <p role="alert" className="px-5 pb-3 text-sm text-red-300">
                      {previewError}
                    </p>
                  )}
                </section>
                {selected && (
                  <OverlapWaveform
                    key={`${selected.id}:${takes.find((take) => take.dialogueId === selected.id && take.selected)?.id ?? 'none'}:${takes.find((take) => take.dialogueId === selected.id && take.selected)?.offsetSeconds ?? 0}`}
                    projectId={project.id}
                    dialogueId={selected.id}
                    cueSeconds={selected.timestampSeconds}
                    playbackSeconds={playbackSeconds}
                    onSourceDuration={handleSourceDuration}
                    liveTakePeaks={
                      liveTake?.dialogueId === selected.id
                        ? liveTake.peaks
                        : undefined
                    }
                  />
                )}
                <section
                  aria-label="Dialogue list"
                  className="overflow-hidden rounded-lg border border-border bg-card"
                >
                  <div className="grid grid-cols-2 border-b border-border sm:grid-cols-[1.6fr_0.8fr_1fr_auto]">
                    <div className="border-r border-border p-4">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">
                        Progress
                      </p>
                      <div className="mt-3 flex items-center gap-3">
                        <div className="h-1.5 flex-1 bg-secondary">
                          <div
                            className="h-full bg-primary"
                            style={{
                              width: `${timeline?.requiredDialogueIds.length ? ((timeline.requiredDialogueIds.length - timeline.missingDialogueIds.length) / timeline.requiredDialogueIds.length) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs font-bold text-primary">
                          {timeline
                            ? timeline.requiredDialogueIds.length -
                              timeline.missingDialogueIds.length
                            : 0}{' '}
                          / {timeline?.requiredDialogueIds.length ?? 0}
                        </span>
                      </div>
                    </div>
                    <div className="border-r border-border p-4">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">
                        Status
                      </p>
                      <p className="mt-3 text-xs font-semibold text-primary">
                        ●{' '}
                        {timeline?.missingDialogueIds.length === 0
                          ? 'Complete'
                          : 'In progress'}
                      </p>
                    </div>
                    <div className="border-r border-border p-4">
                      <p className="text-[10px] font-bold uppercase text-muted-foreground">
                        Updated
                      </p>
                      <p className="mt-3 text-xs text-primary">
                        {new Date(project.updatedAt).toLocaleString()}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowClips(!showClips)}
                      className="flex items-center justify-center gap-2 bg-primary/10 px-4 text-[10px] font-black uppercase text-primary"
                    >
                      <ListFilter aria-hidden="true" className="size-4" />{' '}
                      {showClips ? 'Hide clips' : 'Show clips'}
                    </button>
                  </div>
                  {showClips && (
                    <div className="p-3">
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 px-1">
                        <div>
                          <h2 className="text-xs font-semibold text-muted-foreground">
                            Dialogue clips
                          </h2>
                          <p className="text-[10px] text-muted-foreground">
                            {visibleDialogues.length} clips shown
                          </p>
                        </div>
                      </div>
                      <div className="mb-3 flex items-center gap-2">
                        <Button
                          variant={onlyMyRoles ? 'secondary' : 'ghost'}
                          size="sm"
                          onClick={() => setOnlyMyRoles(!onlyMyRoles)}
                        >
                          <ListFilter aria-hidden="true" />{' '}
                          {onlyMyRoles ? 'My roles' : 'All roles'}
                        </Button>
                        <label className="text-xs text-muted-foreground">
                          Character{' '}
                          <select
                            value={characterFilter}
                            onChange={(event) =>
                              setCharacterFilter(event.target.value)
                            }
                            className="ml-2 rounded border border-border bg-secondary px-2 py-1 text-foreground"
                          >
                            <option value="">All</option>
                            {pack.characters
                              .filter((character) =>
                                project.enabledCharacterIds.includes(
                                  character.id,
                                ),
                              )
                              .map((character) => (
                                <option key={character.id} value={character.id}>
                                  {character.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      <div className="grid max-h-[430px] auto-rows-min gap-1.5 overflow-y-auto pr-1 sm:grid-cols-2 lg:grid-cols-3">
                        {visibleDialogues.map((dialogue) => (
                          <button
                            key={dialogue.id}
                            type="button"
                            onClick={() =>
                              selectDialogue(
                                dialogue.id,
                                dialogue.timestampSeconds,
                              )
                            }
                            className={`flex h-11 min-w-0 items-center gap-3 rounded-sm border px-2 text-left transition-[color,border-color,opacity] ${selectedId === dialogue.id ? 'border-primary bg-primary/15 text-primary' : 'border-border bg-secondary hover:border-primary/50'} ${dialogueMatchesRoles(dialogue, project.enabledCharacterIds) ? '' : 'opacity-50 hover:opacity-75 focus-visible:opacity-100'}`}
                          >
                            <span className="text-[10px] font-black text-primary">
                              {String(
                                pack.dialogues.findIndex(
                                  (item) => item.id === dialogue.id,
                                ) + 1,
                              ).padStart(2, '0')}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs font-semibold">
                              {dialogue.caption || dialogue.sourceRef}
                            </span>
                            {takes.some(
                              (take) =>
                                take.dialogueId === dialogue.id &&
                                take.selected,
                            ) && (
                              <span
                                className="text-[10px] font-bold text-primary"
                                aria-label="Recorded"
                              >
                                ✓
                              </span>
                            )}
                          </button>
                        ))}
                        {visibleDialogues.length === 0 && (
                          <p className="text-sm text-muted-foreground">
                            No dialogue matches the enabled roles.
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </div>

              <aside className="workspace-sidebar lg:col-start-2 lg:row-start-1">
                {selected && (
                  <RecordingStudio
                    key={selected.id}
                    project={project}
                    dialogue={selected}
                    takes={takes.filter(
                      (take) => take.dialogueId === selected.id,
                    )}
                    onChanged={refreshTakes}
                    onHearClip={hearClip}
                    onStopClip={stopClip}
                    clipPlaying={isPlaying}
                    canHearClip={Boolean(
                      audioUrl &&
                      videoReady &&
                      audioReady &&
                      previewRange &&
                      previewRange.endSeconds > previewRange.startSeconds,
                    )}
                    maxDurationSeconds={
                      videoReady &&
                      sampleDuration?.ref === selected.sourceRef &&
                      Number.isFinite(sampleDuration.seconds) &&
                      sampleDuration.seconds > 0
                        ? sampleDuration.seconds
                        : null
                    }
                    onRecordingStart={startRecordingPreview}
                    onPreRollStart={startRecordingPreRoll}
                    onRecordingStop={stopRecordingPreview}
                    onRecordingSample={sampleRecording}
                    onPlayRecording={playTakePreview}
                    voiceEffect={
                      project.voiceEffects?.[selected.id] ?? originalVoiceEffect
                    }
                    onChooseRoles={openRoles}
                    onWatchDub={() => void openWatchDub()}
                    dubReady={Boolean(
                      pack.dialogues.length > 0 &&
                      pack.dialogues.every((dialogue) =>
                        takes.some(
                          (take) =>
                            take.projectId === project.id &&
                            take.dialogueId === dialogue.id &&
                            take.selected,
                        ),
                      ),
                    )}
                    clipPosition={selectedPackIndex + 1}
                    clipCount={pack.dialogues.length}
                    canPreviousClip={Boolean(previousAssigned)}
                    canNextClip={Boolean(nextAssigned)}
                    onPreviousClip={() => {
                      if (previousAssigned)
                        selectDialogue(
                          previousAssigned.id,
                          previousAssigned.timestampSeconds,
                        )
                    }}
                    onNextClip={() => {
                      if (nextAssigned)
                        selectDialogue(
                          nextAssigned.id,
                          nextAssigned.timestampSeconds,
                        )
                    }}
                    onRecordingProgress={(relativeSeconds) =>
                      setPlaybackSeconds(
                        selected.timestampSeconds + relativeSeconds,
                      )
                    }
                  />
                )}
                <div className="mt-5 space-y-2.5">
                  {selected && (
                    <VoiceEffectsPanel
                      effect={
                        project.voiceEffects?.[selected.id] ??
                        originalVoiceEffect
                      }
                      onChange={(effect) => void changeVoiceEffect(effect)}
                    />
                  )}
                  {(
                    [
                      [
                        'Play original audio',
                        playOriginalDuringRecording,
                        setPlayOriginalDuringRecording,
                        'During recording',
                      ],
                      [
                        'Play clip video',
                        playClipVideo,
                        setPlayClipVideo,
                        'While hearing and recording',
                      ],
                      [
                        'Fast mode',
                        fastMode,
                        setFastMode,
                        'Faster dub preview render',
                      ],
                    ] as const
                  ).map(([label, checked, change, description]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-3.5 py-3 text-xs"
                    >
                      <span>
                        <strong className="block">{label}</strong>
                        <span className="text-muted-foreground">
                          {description}
                        </span>
                      </span>
                      <Switch
                        checked={checked}
                        onCheckedChange={change}
                        label={label}
                      />
                    </div>
                  ))}
                </div>
                <dialog
                  ref={rolesDialogRef}
                  aria-label="Choose roles"
                  className="roles-dialog rounded-2xl border border-border bg-card p-6 text-foreground"
                >
                  <div className="flex items-start justify-between gap-4 border-b border-border pb-5">
                    <div>
                      <p className="text-xs font-bold uppercase tracking-widest text-primary">
                        Solo cast
                      </p>
                      <h2 className="mt-1 text-2xl font-black uppercase">
                        Choose your roles
                      </h2>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={closeRoles}
                      aria-label="Close roles"
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </div>
                  <p className="mt-5 text-sm text-muted-foreground">
                    Keep checked the roles you want to dub. Only their clips
                    count toward recording progress and export.
                  </p>
                  <p className="mt-5 text-xs font-bold uppercase text-muted-foreground">
                    Roles to dub
                  </p>
                  <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto">
                    {pack.characters.map((character) => (
                      <label
                        key={character.id}
                        className={`flex cursor-pointer items-center justify-between rounded border px-4 py-3 text-sm ${project.enabledCharacterIds.includes(character.id) ? 'border-primary bg-primary/10' : 'border-border bg-secondary'}`}
                      >
                        <span className="flex items-center gap-3">
                          <PackThumbnail
                            packId={pack.id}
                            assetRef={
                              pack.dialogues.find(
                                (dialogue) =>
                                  dialogue.characterIds.includes(
                                    character.id,
                                  ) && dialogue.imageRef,
                              )?.imageRef ?? pack.iconRef
                            }
                            className="size-12"
                          />
                          <span>
                            {character.name}
                            <span className="ml-2 text-xs text-muted-foreground">
                              {
                                pack.dialogues.filter((dialogue) =>
                                  dialogue.characterIds.includes(character.id),
                                ).length
                              }{' '}
                              lines
                            </span>
                            {character.inferred && (
                              <span className="ml-2 text-xs text-muted-foreground">
                                No tag in pack
                              </span>
                            )}
                          </span>
                        </span>
                        <input
                          type="checkbox"
                          checked={project.enabledCharacterIds.includes(
                            character.id,
                          )}
                          onChange={() => void toggleRole(character.id)}
                          aria-label={`Dub ${character.name}`}
                          className="size-5 shrink-0 cursor-pointer accent-primary"
                        />
                      </label>
                    ))}
                  </div>
                  <Button className="mt-6 w-full" onClick={closeRoles}>
                    Done
                  </Button>
                </dialog>
              </aside>
            </div>
            <WatchDubDialog
              project={project}
              pack={pack}
              open={watchOpen}
              onClose={() => setWatchOpen(false)}
              fastMode={fastMode}
            />
          </MainElement>
        )}
      </div>
    </div>
  )
}
