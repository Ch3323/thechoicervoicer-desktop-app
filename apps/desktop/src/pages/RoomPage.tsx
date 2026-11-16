import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  ChevronDown,
  Copy,
  Download,
  Film,
  Link2,
  ListFilter,
  RefreshCw,
  Users,
  X,
} from 'lucide-react'
import {
  buildAudioTimeline,
  canRecordDialogue,
  createVoiceEffect,
  dialogueMatchesRoles,
  RECORDING_LEAD_IN_SECONDS,
  RECORDING_TAIL_SECONDS,
  roomProjectForPlayer,
  type DubPack,
  type RoomState,
  type DiscoveredRoom,
  type RoomJoinInfo,
  type ImportProgress,
  type VoiceEffect,
} from '@studio/shared'
import { Button } from '@/components/ui/button'
import { RecordingStudio } from '@/components/RecordingStudio'
import { WatchDubDialog } from '@/components/WatchDubDialog'
import { VoiceEffectsPanel } from '@/components/VoiceEffectsPanel'
import { OverlapWaveform } from '@/components/OverlapWaveform'
import { PackThumbnail } from '@/components/PackThumbnail'
import { SessionTopBar } from '@/components/SessionTopBar'
import {
  appendLiveSample,
  newLiveTakeWaveform,
  type LiveTakeWaveform,
} from '@/lib/live-waveform'
import { formatCueTime } from '@/lib/format-cue-time'

type RoomInfo = { state: RoomState; playerId: string; address: string }

function firstAssignedDialogueId(state: RoomState, playerId: string) {
  const roles = roomProjectForPlayer(state, playerId)?.enabledCharacterIds ?? []
  return state.pack?.dialogues.find((dialogue) =>
    dialogueMatchesRoles(dialogue, roles),
  )?.id
}

function loadRoomWaveform(_projectId: string, dialogueId: string) {
  return window.studio.roomGetWaveform(dialogueId)
}

export function RoomPage({
  embedded = false,
  modalOpen,
  onModalClose,
  onRoomInfoChange,
}: {
  embedded?: boolean
  modalOpen?: boolean
  onModalClose?: () => void
  onRoomInfoChange?: (info: RoomInfo | null) => void
} = {}) {
  const navigate = useNavigate()
  const MainElement = embedded ? 'div' : 'main'
  const setupDialogRef = useRef<HTMLDialogElement>(null)
  const lobbyDialogRef = useRef<HTMLDialogElement>(null)
  const joinRolesDialogRef = useRef<HTMLDialogElement>(null)
  const rolePickerRef = useRef<HTMLDialogElement>(null)
  const [internalModalOpen, setInternalModalOpen] = useState(true)
  const roomModalOpen = modalOpen ?? internalModalOpen
  const closeRoomModal = onModalClose ?? (() => setInternalModalOpen(false))
  const closeSetup = () => {
    if (embedded) closeRoomModal()
    else navigate('/')
  }
  const [info, setInfo] = useState<RoomInfo | null>(null)
  const [roomLoaded, setRoomLoaded] = useState(false)
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const [discoveredRooms, setDiscoveredRooms] = useState<DiscoveredRoom[]>([])
  const [discovering, setDiscovering] = useState(false)
  const [downloadProgress, setDownloadProgress] =
    useState<ImportProgress | null>(null)
  const [port, setPort] = useState(4318)
  const [mode, setMode] = useState<'create' | 'join'>('create')
  const [localPacks, setLocalPacks] = useState<DubPack[]>([])
  const [selectedPackId, setSelectedPackId] = useState('')
  const [selectedRoleIds, setSelectedRoleIds] = useState<string[]>([])
  const [joinTarget, setJoinTarget] = useState<{
    address: string
    code: string
    details: RoomJoinInfo
  } | null>(null)
  const [selectedJoinRoleIds, setSelectedJoinRoleIds] = useState<string[]>([])
  const [selectedJoinPackId, setSelectedJoinPackId] = useState('')
  const [copied, setCopied] = useState<'code' | 'invite' | null>(null)
  const [selectedDialogueId, setSelectedDialogueId] = useState('')
  const [previewUrl, setPreviewUrl] = useState('')
  const [sourceAsset, setSourceAsset] = useState<{
    ref: string
    url: string
  } | null>(null)
  const [sourceLength, setSourceLength] = useState<{
    ref: string
    seconds: number
  } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [voiceEffectOverrides, setVoiceEffectOverrides] = useState<
    Record<string, VoiceEffect>
  >({})
  const effectSaveRef = useRef<Promise<void>>(Promise.resolve())
  const [clipPlaying, setClipPlaying] = useState(false)
  const [playbackSeconds, setPlaybackSeconds] = useState(0)
  const [liveTake, setLiveTake] = useState<LiveTakeWaveform | null>(null)
  const [showClips, setShowClips] = useState(true)
  const [onlyMyRoles, setOnlyMyRoles] = useState(false)
  const [characterFilter, setCharacterFilter] = useState('')
  const [showRolePicker, setShowRolePicker] = useState(false)
  const canShowRolePicker = showRolePicker && Boolean(info?.state.pack)
  const [watchOpen, setWatchOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const playheadFrameRef = useRef<number | null>(null)
  const playbackModeRef = useRef<'clip' | 'recording' | null>(null)
  const infoRef = useRef<RoomInfo | null>(null)
  const hasRoom = info !== null

  useEffect(() => {
    void window.studio.getRoom().then((room) => {
      if (room) {
        infoRef.current = room
        if (room.state.started)
          setSelectedDialogueId(
            (current) =>
              current ||
              firstAssignedDialogueId(room.state, room.playerId) ||
              '',
          )
        setInfo(room)
      }
      setRoomLoaded(true)
    })
    return window.studio.onRoomState((state) => {
      setRoomLoaded(true)
      const current = infoRef.current
      if (!state || !current) {
        infoRef.current = null
        setInfo(null)
        setCharacterFilter('')
        setVoiceEffectOverrides({})
        return
      }
      setVoiceEffectOverrides((overrides) => {
        const remaining = { ...overrides }
        for (const [dialogueId, effect] of Object.entries(overrides)) {
          if (
            JSON.stringify(state.project?.voiceEffects?.[dialogueId]) ===
            JSON.stringify(effect)
          )
            delete remaining[dialogueId]
        }
        return remaining
      })
      const next = { ...current, state }
      infoRef.current = next
      if (state.started) {
        const previousRoles = Object.entries(current.state.assignments)
          .filter(([, owner]) => owner === current.playerId)
          .map(([roleId]) => roleId)
        const nextRoles = Object.entries(state.assignments)
          .filter(([, owner]) => owner === current.playerId)
          .map(([roleId]) => roleId)
        const rolesChanged =
          previousRoles.length !== nextRoles.length ||
          previousRoles.some((roleId) => !nextRoles.includes(roleId))
        if (rolesChanged)
          setCharacterFilter((filter) =>
            filter && !nextRoles.includes(filter) ? '' : filter,
          )
        setSelectedDialogueId((selectedId) => {
          if (
            selectedId &&
            (!rolesChanged ||
              state.pack?.dialogues.some(
                (dialogue) =>
                  dialogue.id === selectedId &&
                  dialogueMatchesRoles(dialogue, nextRoles),
              ))
          )
            return selectedId
          return firstAssignedDialogueId(state, current.playerId) || ''
        })
      }
      setInfo(next)
    })
  }, [])

  useEffect(() => {
    if (roomLoaded) onRoomInfoChange?.(info)
  }, [info, onRoomInfoChange, roomLoaded])

  useEffect(() => window.studio.onImportProgress?.(setDownloadProgress), [])

  const scanRooms = useCallback(async () => {
    setDiscovering(true)
    try {
      setDiscoveredRooms(await (window.studio.discoverRooms?.() ?? []))
    } catch (reason) {
      setError(String(reason))
    } finally {
      setDiscovering(false)
    }
  }, [])

  useEffect(() => {
    if (info?.state.started) {
      closeRoomModal()
    }
    // Close the lobby once a game starts; reopening it remains user controlled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.state.started])

  useEffect(() => {
    if (!roomModalOpen) return
    const dialog = hasRoom
      ? lobbyDialogRef.current
      : joinTarget
        ? joinRolesDialogRef.current
        : setupDialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
    }
  }, [hasRoom, joinTarget, roomModalOpen])

  useEffect(() => {
    if (!canShowRolePicker) return
    const dialog = rolePickerRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close()
    }
  }, [canShowRolePicker])

  const state = info?.state
  const isHost = Boolean(state && info?.playerId === state.hostPlayerId)
  const myPlayer = state?.players.find((player) => player.id === info?.playerId)
  const localPackReady = Boolean(
    isHost || (myPlayer && myPlayer.packReady !== false),
  )
  const ready = Boolean(info && state?.readyPlayerIds.includes(info.playerId))
  const connectedPlayers =
    state?.players.filter((player) => player.connected) ?? []
  const allReady =
    connectedPlayers.length > 0 &&
    connectedPlayers.every(
      (player) =>
        player.packReady !== false && state?.readyPlayerIds.includes(player.id),
    )
  const project =
    state && info ? roomProjectForPlayer(state, info.playerId) : null
  const myDialogues =
    state?.pack?.dialogues.filter(
      (dialogue) =>
        project && dialogueMatchesRoles(dialogue, project.enabledCharacterIds),
    ) ?? []
  const selected =
    state?.pack?.dialogues.find((item) => item.id === selectedDialogueId) ??
    state?.pack?.dialogues[0]
  const selectedVoiceEffect = selected
    ? (voiceEffectOverrides[selected.id] ??
      project?.voiceEffects?.[selected.id] ??
      createVoiceEffect('original'))
    : createVoiceEffect('original')
  const canRecord = Boolean(
    state &&
    info &&
    selected &&
    canRecordDialogue(state, info.playerId, selected.id),
  )
  const recordingProject =
    project && !canRecord ? { ...project, enabledCharacterIds: [] } : project
  const selectedTakes =
    state?.takes.filter((take) => take.dialogueId === selected?.id) ?? []
  const visibleDialogues = (state?.pack?.dialogues ?? []).filter((dialogue) =>
    characterFilter
      ? dialogue.characterIds.includes(characterFilter)
      : !onlyMyRoles || myDialogues.some((mine) => mine.id === dialogue.id),
  )
  const myCompleted = myDialogues.filter((dialogue) =>
    state?.takes.some(
      (take) => take.dialogueId === dialogue.id && take.selected,
    ),
  ).length
  const recordedDialogueIds = new Set(
    state?.takes.filter((take) => take.selected).map((take) => take.dialogueId),
  )
  const selectedIndex =
    state?.pack?.dialogues.findIndex(
      (dialogue) => dialogue.id === selected?.id,
    ) ?? -1
  const previousAssigned = state?.pack?.dialogues
    .slice(0, selectedIndex)
    .reverse()
    .find(
      (dialogue) =>
        myDialogues.some((mine) => mine.id === dialogue.id) &&
        (!characterFilter || dialogue.characterIds.includes(characterFilter)),
    )
  const nextAssigned = state?.pack?.dialogues
    .slice(selectedIndex + 1)
    .find(
      (dialogue) =>
        myDialogues.some((mine) => mine.id === dialogue.id) &&
        (!characterFilter || dialogue.characterIds.includes(characterFilter)),
    )
  const selectedCueSeconds = selected?.timestampSeconds
  useEffect(() => {
    if (!state?.started || !previewUrl || selectedCueSeconds === undefined)
      return
    if (videoRef.current) videoRef.current.currentTime = selectedCueSeconds
    // Keep the displayed cue aligned when the selected dialogue changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaybackSeconds(selectedCueSeconds)
  }, [state?.started, previewUrl, selected?.id, selectedCueSeconds])
  const timeline = useMemo(
    () =>
      state?.pack && state.project
        ? buildAudioTimeline(state.pack, state.project, state.takes)
        : null,
    [state],
  )
  const watchContentVersion = JSON.stringify({
    takes: state?.takes,
    effects: state?.project?.voiceEffects,
  })

  useEffect(() => {
    void window.studio.listPacks().then(
      (packs) => {
        setLocalPacks(packs)
        setSelectedPackId((current) => current || packs[0]?.id || '')
      },
      (reason) => setError(String(reason)),
    )
  }, [])

  const setupPack = localPacks.find((item) => item.id === selectedPackId)
  const selectedJoinPack = localPacks.find(
    (item) => item.id === selectedJoinPackId,
  )

  const packId = state?.pack?.id
  useEffect(() => {
    if (!packId || !localPackReady) return
    let active = true
    void window.studio.roomGetPreviewUrl().then(
      (url) => {
        if (active) setPreviewUrl(url)
      },
      (reason) => {
        if (active) setError(String(reason))
      },
    )
    return () => {
      active = false
    }
  }, [packId, localPackReady])

  const sourceRef = selected?.sourceRef
  const handleSourceDuration = useCallback(
    (seconds: number) => {
      if (sourceRef)
        setSourceLength((current) =>
          current?.ref === sourceRef && current.seconds === seconds
            ? current
            : { ref: sourceRef, seconds },
        )
    },
    [sourceRef],
  )
  const sourceUrl =
    sourceAsset && sourceAsset.ref === sourceRef ? sourceAsset.url : ''
  const sourceDuration =
    sourceLength && sourceLength.ref === sourceRef ? sourceLength.seconds : 0
  useEffect(() => {
    if (!sourceRef || !localPackReady) return
    let active = true
    void window.studio.roomGetAssetUrl(sourceRef).then(
      (url) => {
        if (active) setSourceAsset({ ref: sourceRef, url })
      },
      (reason) => {
        if (active) setError(String(reason))
      },
    )
    return () => {
      active = false
    }
  }, [sourceRef, localPackReady])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  function changeVoiceEffect(dialogueId: string, effect: VoiceEffect) {
    if (playbackModeRef.current === 'recording') stopMedia()
    setVoiceEffectOverrides((current) => ({ ...current, [dialogueId]: effect }))
    const pending = effectSaveRef.current.then(() =>
      window.studio.roomSetVoiceEffect(dialogueId, effect),
    )
    effectSaveRef.current = pending.then(
      () => undefined,
      () => undefined,
    )
    void pending.catch((reason: unknown) => {
      setVoiceEffectOverrides((current) => {
        if (current[dialogueId] !== effect) return current
        const remaining = { ...current }
        delete remaining[dialogueId]
        return remaining
      })
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }

  async function host() {
    await run(async () => {
      if (!setupPack || selectedRoleIds.length === 0)
        throw new Error('Choose a pack and at least one role')
      const room = await window.studio.createRoom(name, port)
      try {
        await window.studio.roomSetPack(setupPack.id)
        for (const roleId of selectedRoleIds)
          await window.studio.roomClaimRole(roleId)
        const updated = await window.studio.getRoom()
        infoRef.current = updated ?? room
        setInfo(updated ?? room)
      } catch (reason) {
        await window.studio.roomClose()
        throw reason
      }
    })
  }
  async function join(selectedAddress?: string, selectedCode?: string) {
    await run(async () => {
      const playerName = name.trim()
      if (!playerName) throw new Error('Enter your name to join a room')
      let targetAddress = selectedAddress ?? address.trim()
      const targetCode = selectedCode ?? code.trim()
      if (!targetAddress && targetCode) {
        const rooms = await window.studio.discoverRooms()
        setDiscoveredRooms(rooms)
        const found = rooms.find(
          (room) => room.code === targetCode.toUpperCase(),
        )
        if (!found)
          throw new Error(
            'Room code not found on the local network. Enter the Host IP address instead.',
          )
        targetAddress = found.address
      }
      if (!targetAddress)
        throw new Error('Enter a room code or Host IP address')
      const details = await window.studio.getRoomJoinInfo(
        targetAddress,
        targetCode,
        playerName,
      )
      if (details.started) throw new Error('Room has already started')
      setLocalPacks(await window.studio.listPacks())
      setSelectedJoinRoleIds([])
      setSelectedJoinPackId('')
      setJoinTarget({ address: targetAddress, code: targetCode, details })
    })
  }
  async function confirmJoin() {
    if (!joinTarget) return
    await run(async () => {
      if (
        !selectedJoinPackId ||
        !joinTarget.details.matchingPacks.some(
          (pack) => pack.id === selectedJoinPackId,
        )
      )
        throw new Error('Download or select the matching Dub Pack first')
      if (!selectedJoinRoleIds.length)
        throw new Error('Choose at least one available role')
      let room: RoomInfo
      try {
        room = await window.studio.joinRoom(
          joinTarget.address,
          joinTarget.details.code,
          name.trim(),
          selectedJoinPackId,
          selectedJoinRoleIds,
        )
      } catch (reason) {
        try {
          const details = await window.studio.getRoomJoinInfo(
            joinTarget.address,
            joinTarget.code,
            name.trim(),
          )
          setJoinTarget({ ...joinTarget, details })
          setSelectedJoinPackId((current) =>
            details.matchingPacks.some((pack) => pack.id === current)
              ? current
              : '',
          )
          setSelectedJoinRoleIds((current) =>
            current.filter((id) =>
              details.roles.some((role) => role.id === id && role.available),
            ),
          )
        } catch {
          // Preserve the join error when the Host is no longer reachable.
        }
        throw reason
      }
      setJoinTarget(null)
      setSelectedDialogueId(
        room.state.started
          ? firstAssignedDialogueId(room.state, room.playerId) || ''
          : '',
      )
      infoRef.current = room
      setInfo(room)
    })
  }
  async function importPack() {
    await run(async () => {
      const pack = await window.studio.importPack()
      if (!pack) return
      setLocalPacks(await window.studio.listPacks())
      setSelectedPackId(pack.id)
      setSelectedRoleIds([])
    })
  }
  async function downloadJoinPack() {
    if (!joinTarget) return
    await run(async () => {
      setDownloadProgress(null)
      const pack = await window.studio.prepareRoomPack(
        joinTarget.address,
        joinTarget.details.code,
      )
      const details = await window.studio.getRoomJoinInfo(
        joinTarget.address,
        joinTarget.details.code,
        name.trim(),
      )
      setJoinTarget({ ...joinTarget, details })
      setLocalPacks(await window.studio.listPacks())
      if (!details.matchingPacks.some((item) => item.id === pack.id))
        throw new Error(
          'The Host pack changed. Download the current pack again.',
        )
      setSelectedJoinPackId(pack.id)
    })
  }

  async function copyRoom(kind: 'code' | 'invite') {
    if (!info) return
    try {
      await window.studio.copyRoomDetails(kind)
      setCopied(kind)
    } catch {
      setError(
        'Could not copy room details. Share the code and host address shown here.',
      )
    }
  }
  async function leave() {
    await run(async () => {
      setShowRolePicker(false)
      if (isHost) await window.studio.roomClose()
      else await window.studio.roomLeave()
      setSelectedDialogueId('')
      infoRef.current = null
      setInfo(null)
    })
  }
  async function openWatch() {
    await effectSaveRef.current
    setWatchOpen(true)
  }
  const stopMedia = useCallback(() => {
    videoRef.current?.pause()
    audioRef.current?.pause()
    playbackModeRef.current = null
    if (playheadFrameRef.current !== null)
      cancelAnimationFrame(playheadFrameRef.current)
    playheadFrameRef.current = null
    setClipPlaying(false)
  }, [])
  useEffect(() => stopMedia, [stopMedia])
  const startPlayheadLoop = (position: () => number, end?: number) => {
    if (playheadFrameRef.current !== null)
      cancelAnimationFrame(playheadFrameRef.current)
    const frame = () => {
      const seconds = position()
      if (end !== undefined && seconds >= end) {
        setPlaybackSeconds(end)
        if (playbackModeRef.current === 'clip') stopMedia()
        else playheadFrameRef.current = null
        return
      }
      setPlaybackSeconds(seconds)
      playheadFrameRef.current = requestAnimationFrame(frame)
    }
    playheadFrameRef.current = requestAnimationFrame(frame)
  }
  const hearClip = () => {
    const video = videoRef.current
    const audio = audioRef.current
    if (!video || !audio || !selected) return
    if (clipPlaying) {
      stopMedia()
      return
    }
    video.currentTime = selected.timestampSeconds
    audio.currentTime = 0
    setPlaybackSeconds(selected.timestampSeconds)
    playbackModeRef.current = 'clip'
    setClipPlaying(true)
    void Promise.all([video.play(), audio.play()])
      .then(() => {
        if (playbackModeRef.current === 'clip')
          startPlayheadLoop(
            () => selected.timestampSeconds + audio.currentTime,
            selected.timestampSeconds + sourceDuration,
          )
      })
      .catch((reason) => {
        stopMedia()
        setError(String(reason))
      })
  }

  return (
    <MainElement
      className={`studio-app workspace-page bg-background text-foreground ${embedded ? 'room-embedded' : 'min-h-screen'}`}
    >
      {!embedded && (
        <SessionTopBar
          title={state?.pack?.metadata.title}
          roomCode={state?.code}
          onOpenRoom={() => setInternalModalOpen(true)}
          onLeaveRoom={info ? () => void leave() : undefined}
        />
      )}
      <div
        className={
          embedded
            ? 'space-y-6'
            : 'mx-auto max-w-[1200px] space-y-6 px-5 py-6 sm:px-8'
        }
      >
        {error && !roomModalOpen && (
          <p
            role="alert"
            className="rounded-lg border border-red-500 p-3 text-red-200"
          >
            {error}
          </p>
        )}
        {!info && joinTarget && roomModalOpen ? (
          <dialog
            ref={joinRolesDialogRef}
            className="multiplayer-panel multiplayer-setup-dialog multiplayer-join-roles-dialog"
            aria-label="Choose available roles"
            onCancel={(event) => {
              event.preventDefault()
              setJoinTarget(null)
            }}
          >
            <div className="multiplayer-heading">
              <h1>
                {selectedJoinPackId ? 'CHOOSE YOUR ROLES' : 'CHOOSE YOUR PACK'}
              </h1>
              <button
                type="button"
                aria-label="Back to rooms"
                onClick={() => setJoinTarget(null)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-300">
                {error}
              </p>
            )}
            <div className="multiplayer-form">
              <div className="multiplayer-pack-line multiplayer-lobby-pack">
                <div className="multiplayer-lobby-pack-details">
                  <small>VOICE PACK</small>
                  <strong>{joinTarget.details.title}</strong>
                  <span>{joinTarget.details.roles.length} roles</span>
                </div>
                <Button
                  size="icon"
                  className="multiplayer-pack-download-button"
                  aria-label="Download pack from Host"
                  title="Download pack from Host"
                  disabled={busy}
                  onClick={() => void downloadJoinPack()}
                >
                  <Download aria-hidden="true" />
                </Button>
              </div>
              <label className="multiplayer-field">
                MATCHING PACK ON THIS DEVICE
                <span className="multiplayer-select-control">
                  <select
                    aria-label="Matching Dub Pack"
                    value={selectedJoinPackId}
                    disabled={
                      busy || joinTarget.details.matchingPacks.length === 0
                    }
                    onChange={(event) => {
                      setSelectedJoinPackId(event.target.value)
                      setSelectedJoinRoleIds([])
                    }}
                  >
                    <option value="">SELECT A PACK</option>
                    {joinTarget.details.matchingPacks.map((pack) => (
                      <option key={pack.id} value={pack.id}>
                        {pack.title}
                      </option>
                    ))}
                  </select>
                  <ChevronDown aria-hidden="true" />
                </span>
              </label>
              {!selectedJoinPackId && (
                <p className="multiplayer-hint">
                  Download the Host pack or select a matching pack on this
                  device to choose roles.
                </p>
              )}
              {busy && downloadProgress && (
                <p className="multiplayer-hint" role="status">
                  {downloadProgress.totalBytes > 0
                    ? `${Math.round((downloadProgress.completedBytes / downloadProgress.totalBytes) * 100)}% downloaded`
                    : 'Preparing pack download…'}
                </p>
              )}
              {selectedJoinPackId && (
                <>
                  <div className="multiplayer-role-title">
                    YOUR ROLES · SELECT ONE OR MORE
                  </div>
                  <div className="multiplayer-role-grid">
                    {joinTarget.details.roles.map((role) => {
                      const checked = selectedJoinRoleIds.includes(role.id)
                      return (
                        <label
                          key={role.id}
                          className={`multiplayer-role-option ${checked ? 'selected' : ''} ${!role.available ? 'unavailable' : ''}`}
                        >
                          {selectedJoinPack && (
                            <PackThumbnail
                              packId={selectedJoinPack.id}
                              assetRef={roleImageRef(selectedJoinPack, role.id)}
                              className="multiplayer-role-avatar"
                            />
                          )}
                          <span>
                            <strong>{role.name}</strong>
                            <small>{role.clips} CLIPS</small>
                          </span>
                          <input
                            type="checkbox"
                            disabled={!role.available || busy}
                            checked={checked}
                            onChange={() =>
                              setSelectedJoinRoleIds((current) =>
                                checked
                                  ? current.filter((id) => id !== role.id)
                                  : [...current, role.id],
                              )
                            }
                          />
                        </label>
                      )
                    })}
                  </div>
                  <Button
                    className="multiplayer-primary"
                    disabled={busy || selectedJoinRoleIds.length === 0}
                    onClick={() => void confirmJoin()}
                  >
                    {busy ? 'JOINING…' : 'JOIN ROOM'}
                  </Button>
                </>
              )}
            </div>
          </dialog>
        ) : !info && roomModalOpen ? (
          <dialog
            ref={setupDialogRef}
            className="multiplayer-panel multiplayer-setup-dialog"
            aria-label="Multiplayer mode"
            onCancel={(event) => {
              event.preventDefault()
              closeSetup()
            }}
          >
            <div className="multiplayer-heading">
              <h1>MULTIPLAYER MODE</h1>
              <button
                type="button"
                onClick={closeSetup}
                aria-label="Close multiplayer"
              >
                <X aria-hidden="true" />
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-300">
                {error}
              </p>
            )}
            <div
              className="multiplayer-tabs"
              role="tablist"
              aria-label="Room action"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'create'}
                onClick={() => setMode('create')}
              >
                CREATE ROOM
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'join'}
                onClick={() => {
                  setMode('join')
                  void scanRooms()
                }}
              >
                JOIN ROOM
              </button>
            </div>
            <div className="multiplayer-form">
              <label className="multiplayer-field">
                YOUR NAME
                <input
                  value={name}
                  maxLength={32}
                  autoFocus
                  required
                  placeholder="Enter your name"
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              {mode === 'join' && (
                <>
                  <div className="multiplayer-room-browser">
                    <div className="multiplayer-room-browser-heading">
                      <span>AVAILABLE ROOMS</span>
                      <Button
                        variant="outline"
                        className="multiplayer-refresh"
                        aria-label={
                          discovering ? 'Scanning rooms' : 'Refresh rooms'
                        }
                        title={discovering ? 'Scanning rooms' : 'Refresh rooms'}
                        onClick={() => void scanRooms()}
                        disabled={discovering}
                      >
                        <RefreshCw
                          aria-hidden="true"
                          className={
                            discovering ? 'multiplayer-refresh-spinning' : ''
                          }
                        />
                      </Button>
                    </div>
                    <div className="multiplayer-room-list">
                      {discoveredRooms.map((room) => (
                        <button
                          key={room.address}
                          type="button"
                          className="multiplayer-room-card"
                          disabled={busy || !name.trim()}
                          onClick={() => void join(room.address, room.code)}
                        >
                          <span className="multiplayer-room-card-icon">
                            <Users aria-hidden="true" />
                          </span>
                          <span className="multiplayer-room-card-details">
                            <strong>{room.title}</strong>
                            <small>
                              {room.players}{' '}
                              {room.players === 1 ? 'player' : 'players'} ·{' '}
                              {room.address}
                            </small>
                          </span>
                          <span className="multiplayer-room-card-action">
                            JOIN <ArrowRight aria-hidden="true" />
                          </span>
                        </button>
                      ))}
                      {!discovering && discoveredRooms.length === 0 && (
                        <small className="multiplayer-room-empty">
                          No rooms found. You can enter an address below.
                        </small>
                      )}
                    </div>
                  </div>
                  <p className="multiplayer-role-title multiplayer-join-by-title">
                    JOIN BY CODE OR IP ADDRESS
                  </p>
                  <label className="multiplayer-field">
                    ROOM CODE (OPTIONAL)
                    <input
                      className="room-code-input"
                      value={code}
                      maxLength={6}
                      placeholder="ABC234"
                      onChange={(event) =>
                        setCode(event.target.value.toUpperCase())
                      }
                    />
                  </label>
                  <label className="multiplayer-field">
                    HOST IP ADDRESS (OPTIONAL)
                    <input
                      value={address}
                      placeholder="192.168.1.5 or 192.168.1.5:4318"
                      onChange={(event) => setAddress(event.target.value)}
                    />
                  </label>
                </>
              )}
              {mode === 'create' && (
                <>
                  <div className="multiplayer-pack-line">
                    {setupPack && (
                      <div className="multiplayer-pack-art">
                        <PackThumbnail
                          packId={setupPack.id}
                          assetRef={setupPack.iconRef}
                        />
                      </div>
                    )}
                    <div className="multiplayer-field">
                      <label htmlFor="multiplayer-voice-pack">VOICE PACK</label>
                      <div className="multiplayer-pack-controls">
                        <span className="multiplayer-select-control">
                          <select
                            id="multiplayer-voice-pack"
                            aria-label="Voice pack"
                            value={selectedPackId}
                            disabled={localPacks.length === 0}
                            onChange={(event) => {
                              setSelectedPackId(event.target.value)
                              setSelectedRoleIds([])
                            }}
                          >
                            {localPacks.length === 0 && (
                              <option value="">No Dub Packs imported</option>
                            )}
                            {localPacks.map((pack) => (
                              <option key={pack.id} value={pack.id}>
                                {pack.metadata.title}
                              </option>
                            ))}
                          </select>
                          <ChevronDown aria-hidden="true" />
                        </span>
                        <Button
                          variant="outline"
                          onClick={() => void importPack()}
                          disabled={busy}
                        >
                          IMPORT ZIP
                        </Button>
                      </div>
                      {setupPack && (
                        <small>
                          {setupPack.dialogues.length} clips ·{' '}
                          {setupPack.characters.length} roles
                        </small>
                      )}
                    </div>
                  </div>
                  <div className="multiplayer-role-title">
                    YOUR ROLES · SELECT ONE OR MORE
                  </div>
                  <div className="multiplayer-role-grid">
                    {setupPack?.characters.map((character) => {
                      const checked = selectedRoleIds.includes(character.id)
                      const clips = setupPack.dialogues.filter((dialogue) =>
                        dialogue.characterIds.includes(character.id),
                      ).length
                      return (
                        <label
                          key={character.id}
                          className={`multiplayer-role-option ${checked ? 'selected' : ''}`}
                        >
                          <PackThumbnail
                            packId={setupPack.id}
                            assetRef={roleImageRef(setupPack, character.id)}
                            className="multiplayer-role-avatar"
                          />
                          <span>
                            <strong>{character.name}</strong>
                            <small>{clips} CLIPS</small>
                          </span>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedRoleIds((current) =>
                                checked
                                  ? current.filter((id) => id !== character.id)
                                  : [...current, character.id],
                              )
                            }
                          />
                        </label>
                      )
                    })}
                    {!setupPack && (
                      <p className="multiplayer-hint">
                        Choose or import a pack to see its roles.
                      </p>
                    )}
                  </div>
                  <label className="multiplayer-field">
                    NETWORK PORT
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={port}
                      onChange={(event) => setPort(Number(event.target.value))}
                    />
                  </label>
                </>
              )}
              <Button
                className="multiplayer-primary"
                onClick={() => void (mode === 'create' ? host() : join())}
                disabled={
                  busy ||
                  (mode === 'create'
                    ? !name.trim() || !setupPack || selectedRoleIds.length === 0
                    : !name.trim() ||
                      (!address.trim() && code.trim().length !== 6))
                }
              >
                {busy
                  ? 'CONNECTING…'
                  : mode === 'create'
                    ? 'CREATE ROOM'
                    : 'JOIN ROOM'}
              </Button>
              <p className="multiplayer-foot">
                Each player keeps their own Dub Pack copy.
              </p>
            </div>
          </dialog>
        ) : !info ? (
          <p className="multiplayer-hint mt-8 text-center">
            Open Multiplayer to create or join a room.
          </p>
        ) : state && roomModalOpen ? (
          <dialog
            ref={lobbyDialogRef}
            className="multiplayer-panel multiplayer-lobby multiplayer-setup-dialog"
            aria-label="Room lobby"
            onCancel={(event) => {
              event.preventDefault()
              setShowRolePicker(false)
              closeRoomModal()
            }}
          >
            <div className="multiplayer-heading">
              <h1>MULTIPLAYER MODE</h1>
              <button
                type="button"
                aria-label="Close room details"
                onClick={() => {
                  setShowRolePicker(false)
                  closeRoomModal()
                }}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-300">
                {error}
              </p>
            )}
            <p className="multiplayer-lobby-message">
              Share the room details.{' '}
              {state.pack?.characters.filter(
                (character) => !state.assignments[character.id],
              ).length ?? 0}{' '}
              more roles need a player.
            </p>
            <div className="multiplayer-room-code">
              <small>ROOM CODE</small>
              <strong>{state.code}</strong>
            </div>
            <div className="multiplayer-copy-row">
              <button type="button" onClick={() => void copyRoom('code')}>
                <Copy aria-hidden="true" />{' '}
                {copied === 'code' ? 'COPIED' : 'COPY CODE'}
              </button>
              <button type="button" onClick={() => void copyRoom('invite')}>
                <Link2 aria-hidden="true" />{' '}
                {copied === 'invite' ? 'COPIED' : 'COPY INVITE DETAILS'}
              </button>
            </div>
            <p className="multiplayer-address">
              Host address: <strong>{info.address}</strong>
            </p>
            {state.pack ? (
              <>
                <div className="multiplayer-pack-line multiplayer-lobby-pack">
                  <div className="multiplayer-pack-art">
                    <RoomPackThumbnail assetRef={state.pack.iconRef} />
                  </div>
                  <div className="multiplayer-lobby-pack-details">
                    <small>VOICE PACK</small>
                    <strong>{state.pack.metadata.title}</strong>
                    <span>
                      {state.pack.dialogues.length} clips ·{' '}
                      {state.pack.characters.length} roles
                    </span>
                  </div>
                  {!state.started && (
                    <Button
                      className="multiplayer-choose-roles"
                      variant="outline"
                      onClick={() => setShowRolePicker(true)}
                    >
                      CHOOSE ROLES
                    </Button>
                  )}
                </div>
                <div className="multiplayer-lobby-roles">
                  {state.pack.characters.map((character, index) => {
                    const ownerId = state.assignments[character.id]
                    const owner = state.players.find(
                      (player) => player.id === ownerId,
                    )
                    const mine = ownerId === info.playerId
                    const roleDialogues = state.pack!.dialogues.filter(
                      (dialogue) =>
                        dialogue.characterIds.includes(character.id),
                    )
                    const clips = roleDialogues.length
                    const recorded = roleDialogues.filter((dialogue) =>
                      recordedDialogueIds.has(dialogue.id),
                    ).length
                    return (
                      <div
                        className={`multiplayer-lobby-role ${mine ? 'mine' : ''}`}
                        key={character.id}
                      >
                        <span
                          className="multiplayer-role-avatar"
                          style={{
                            borderColor: `hsl(${(index * 43) % 360} 80% 60%)`,
                          }}
                        >
                          <RoomPackThumbnail
                            assetRef={roleImageRef(state.pack!, character.id)}
                          />
                        </span>
                        <span className="multiplayer-lobby-role-copy">
                          <strong>
                            {character.name} {owner?.isHost ? '⚑' : ''}
                          </strong>
                          <small>{clips} CLIPS</small>
                          {owner && <em>{owner.displayName}</em>}
                        </span>
                        <span
                          className={`multiplayer-role-progress ${recorded === clips ? 'complete' : ''}`}
                          aria-label={`${character.name}: ${recorded} of ${clips} lines recorded`}
                        >
                          {recorded}/{clips}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <p className="multiplayer-hint">
                Waiting for the host to choose a voice pack.
              </p>
            )}
            {!state.started && (
              <Button
                className={`multiplayer-primary ${ready ? 'multiplayer-cancel-ready' : ''}`}
                disabled={
                  busy ||
                  !state.pack ||
                  !localPackReady ||
                  (!isHost && !project?.enabledCharacterIds.length)
                }
                onClick={() =>
                  void run(() => window.studio.roomSetReady(!ready))
                }
              >
                {ready
                  ? 'CANCEL READY'
                  : localPackReady
                    ? 'READY TO PLAY'
                    : 'DOWNLOAD PACK FIRST'}
              </Button>
            )}
            {isHost && !state.started && (
              <Button
                className="multiplayer-start"
                disabled={busy || !allReady || !state.pack}
                onClick={() => void run(() => window.studio.roomStart())}
              >
                START GAME
              </Button>
            )}
            <Button
              className="multiplayer-lobby-leave"
              variant="outline"
              disabled={busy}
              onClick={() => void leave()}
            >
              LEAVE ROOM
            </Button>
          </dialog>
        ) : state && !state.started ? (
          embedded ? null : (
            <p className="multiplayer-hint mt-8 text-center">
              Waiting to start. Open In room to see players and roles.
            </p>
          )
        ) : (
          <>
            {state?.pack && state.project && project && (
              <>
                {!state.started && (
                  <section className="rounded-2xl border border-border bg-card p-5">
                    <h2 className="text-xl font-semibold">
                      {state.pack.metadata.title}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {timeline
                        ? `${timeline.requiredDialogueIds.length - timeline.missingDialogueIds.length} of ${timeline.requiredDialogueIds.length} lines recorded`
                        : 'Loading progress'}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Choose one or more roles. Each role belongs to one player.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {state.pack.characters.map((character) => {
                        const owner = state.assignments[character.id]
                        const player = state.players.find(
                          (item) => item.id === owner,
                        )
                        const canRelease =
                          owner === info.playerId ||
                          (isHost && player?.connected === false)
                        return (
                          <Button
                            key={character.id}
                            size="sm"
                            variant={
                              owner === info.playerId ? 'default' : 'outline'
                            }
                            disabled={busy || Boolean(owner && !canRelease)}
                            onClick={() =>
                              void run(() =>
                                owner
                                  ? window.studio.roomReleaseRole(character.id)
                                  : window.studio.roomClaimRole(character.id),
                              )
                            }
                          >
                            {character.name}
                            {player
                              ? ` · ${player.displayName}${!player.connected ? ' (release)' : ''}`
                              : ' · Claim'}
                          </Button>
                        )
                      })}
                    </div>
                  </section>
                )}
                {!state.started && (
                  <section className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 className="text-xl font-bold uppercase">
                          Ready to play?
                        </h2>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {state.readyPlayerIds.length} of{' '}
                          {connectedPlayers.length} connected players ready.
                        </p>
                      </div>
                      <Button
                        variant={ready ? 'secondary' : 'default'}
                        className={
                          ready ? 'multiplayer-cancel-ready' : undefined
                        }
                        disabled={
                          busy ||
                          !localPackReady ||
                          (!isHost && !project.enabledCharacterIds.length)
                        }
                        onClick={() =>
                          void run(() => window.studio.roomSetReady(!ready))
                        }
                      >
                        {ready
                          ? 'Cancel ready'
                          : localPackReady
                            ? 'Ready to play'
                            : 'Download pack first'}
                      </Button>
                    </div>
                    {isHost ? (
                      <Button
                        className="mt-4 w-full"
                        disabled={busy || !allReady}
                        onClick={() =>
                          void run(() => window.studio.roomStart())
                        }
                      >
                        Start game
                      </Button>
                    ) : (
                      <p className="mt-4 text-sm text-muted-foreground">
                        {ready
                          ? 'Waiting for Host to start the game.'
                          : 'Choose your roles and mark yourself ready.'}
                      </p>
                    )}
                  </section>
                )}
                {state.started && (
                  <>
                    <div className="mb-7 pt-8">
                      <p className="text-xs uppercase tracking-[0.18em] text-primary">
                        VOICE PACK / RECORDING SESSION
                      </p>
                      <h1 className="mt-2 text-3xl font-semibold">
                        {state.pack.metadata.title}
                      </h1>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {state.pack.dialogues.length} dialogue instances ·{' '}
                        {state.pack.characters.length} characters ·{' '}
                        {myCompleted}/{myDialogues.length} assigned lines
                        complete
                      </p>
                    </div>
                    <div className="workspace-grid grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                      <section
                        aria-label="Dialogue list"
                        className="order-2 overflow-hidden rounded-lg border border-border bg-card lg:col-start-1 lg:row-start-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
                          <div>
                            <p className="text-[10px] font-bold uppercase text-muted-foreground">
                              Progress
                            </p>
                            <p className="mt-1 text-sm font-bold text-primary">
                              {myCompleted} / {myDialogues.length} your clips
                              recorded
                            </p>
                          </div>
                          <button
                            type="button"
                            className="flex items-center gap-2 text-xs font-bold text-primary"
                            onClick={() => setShowClips(!showClips)}
                          >
                            <ListFilter className="size-4" />{' '}
                            {showClips ? 'Hide clips' : 'Show clips'}
                          </button>
                        </div>
                        {showClips && (
                          <div className="p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                variant={onlyMyRoles ? 'secondary' : 'ghost'}
                                size="sm"
                                onClick={() => setOnlyMyRoles(!onlyMyRoles)}
                              >
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
                                  {state.pack.characters
                                    .filter((character) =>
                                      project.enabledCharacterIds.includes(
                                        character.id,
                                      ),
                                    )
                                    .map((character) => (
                                      <option
                                        key={character.id}
                                        value={character.id}
                                      >
                                        {character.name}
                                      </option>
                                    ))}
                                </select>
                              </label>
                            </div>
                            <div className="mt-3 grid max-h-[430px] gap-1.5 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
                              {visibleDialogues.map((dialogue) => {
                                const done = state.takes.some(
                                  (take) =>
                                    take.dialogueId === dialogue.id &&
                                    take.selected,
                                )
                                return (
                                  <button
                                    type="button"
                                    key={dialogue.id}
                                    className={`flex h-12 min-w-0 items-center gap-2 rounded border px-3 text-left text-xs ${selected?.id === dialogue.id ? 'border-primary bg-primary/15' : 'border-border bg-secondary'} ${myDialogues.some((mine) => mine.id === dialogue.id) ? '' : 'opacity-55'}`}
                                    onClick={() => {
                                      stopMedia()
                                      setSelectedDialogueId(dialogue.id)
                                      if (videoRef.current)
                                        videoRef.current.currentTime =
                                          dialogue.timestampSeconds
                                      setPlaybackSeconds(
                                        dialogue.timestampSeconds,
                                      )
                                    }}
                                  >
                                    <span className="font-bold text-primary">
                                      {String(
                                        state.pack!.dialogues.indexOf(
                                          dialogue,
                                        ) + 1,
                                      ).padStart(2, '0')}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate">
                                      {dialogue.caption || dialogue.sourceRef}
                                    </span>
                                    {done && (
                                      <span
                                        aria-label="Recorded"
                                        className="text-primary"
                                      >
                                        ✓
                                      </span>
                                    )}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </section>
                      <section className="order-1 space-y-4 lg:col-start-1 lg:row-start-1">
                        <div
                          aria-label="Video player"
                          className="workspace-monitor overflow-hidden rounded-2xl border border-border bg-black"
                        >
                          <div className="relative aspect-video w-full bg-black">
                            <video
                              ref={videoRef}
                              src={previewUrl}
                              muted
                              playsInline
                              preload="metadata"
                              className="absolute inset-0 h-full w-full object-contain"
                              onLoadedMetadata={(event) => {
                                if (selected)
                                  event.currentTarget.currentTime =
                                    selected.timestampSeconds
                              }}
                              onTimeUpdate={(event) => {
                                const video = event.currentTarget
                                if (
                                  playbackModeRef.current &&
                                  selected &&
                                  sourceDuration > 0
                                ) {
                                  const end =
                                    selected.timestampSeconds + sourceDuration
                                  if (video.currentTime >= end) {
                                    video.pause()
                                    if (
                                      Math.abs(video.currentTime - end) > 0.02
                                    )
                                      video.currentTime = end
                                  }
                                } else if (!playbackModeRef.current)
                                  setPlaybackSeconds(video.currentTime)
                              }}
                            />
                            <audio
                              ref={audioRef}
                              src={sourceUrl}
                              onLoadedMetadata={(event) =>
                                setSourceLength({
                                  ref: sourceRef!,
                                  seconds: event.currentTarget.duration,
                                })
                              }
                              onEnded={() => {
                                if (selected)
                                  setPlaybackSeconds(
                                    selected.timestampSeconds + sourceDuration,
                                  )
                                stopMedia()
                              }}
                            />
                            {selected && (
                              <>
                                <div className="pointer-events-none absolute left-4 top-4 rounded border border-white/25 bg-black/75 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider text-white">
                                  <span className="mr-2 inline-block size-1.5 rounded-full bg-rose-500 shadow-[0_0_8px_#f43f5e]" />
                                  Cue{' '}
                                  <span className="text-amber-300">
                                    {formatCueTime(playbackSeconds)}
                                  </span>
                                </div>
                                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/75 to-transparent px-5 pb-6 pt-16 text-center">
                                  <div className="flex justify-center gap-2">
                                    {selected.characterIds.map((id) => (
                                      <span
                                        key={id}
                                        className="bg-primary px-2 py-0.5 text-[10px] font-black uppercase text-primary-foreground"
                                      >
                                        {state.pack?.characters.find(
                                          (character) => character.id === id,
                                        )?.name ?? id}
                                      </span>
                                    ))}
                                  </div>
                                  <p className="mt-2 text-lg font-black text-white sm:text-2xl">
                                    {selected.caption || selected.sourceRef}
                                  </p>
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                        {selected && (
                          <OverlapWaveform
                            key={`${selected.id}:${selectedTakes.find((take) => take.selected)?.id ?? 'none'}`}
                            projectId={project.id}
                            dialogueId={selected.id}
                            cueSeconds={selected.timestampSeconds}
                            playbackSeconds={playbackSeconds}
                            onSourceDuration={handleSourceDuration}
                            loadWaveform={loadRoomWaveform}
                            liveTakePeaks={
                              liveTake?.dialogueId === selected.id
                                ? liveTake.peaks
                                : undefined
                            }
                          />
                        )}
                      </section>
                      <aside className="workspace-sidebar order-3 lg:col-start-2 lg:row-start-1 lg:row-span-2">
                        {selected && recordingProject && (
                          <RecordingStudio
                            key={selected.id}
                            project={recordingProject}
                            dialogue={selected}
                            takes={selectedTakes}
                            onChanged={async () => {
                              setLiveTake(null)
                            }}
                            onHearClip={hearClip}
                            onStopClip={stopMedia}
                            clipPlaying={clipPlaying}
                            canHearClip={Boolean(sourceUrl && previewUrl)}
                            maxDurationSeconds={sourceDuration || null}
                            onRecordingStart={() => {
                              playbackModeRef.current = 'recording'
                              setLiveTake(newLiveTakeWaveform(selected.id))
                              const cue = selected.timestampSeconds
                              const startedAt = performance.now()
                              startPlayheadLoop(
                                () =>
                                  cue +
                                  Math.min(
                                    sourceDuration,
                                    (performance.now() - startedAt) / 1000,
                                  ),
                                cue + sourceDuration,
                              )
                              if (videoRef.current) {
                                videoRef.current.currentTime =
                                  selected.timestampSeconds
                                void videoRef.current
                                  .play()
                                  .catch((reason) => setError(String(reason)))
                              }
                            }}
                            onPreRollStart={() => {
                              playbackModeRef.current = 'recording'
                              const cue = selected.timestampSeconds
                              const startedAt = performance.now()
                              setPlaybackSeconds(
                                cue - RECORDING_LEAD_IN_SECONDS,
                              )
                              startPlayheadLoop(
                                () =>
                                  cue -
                                  RECORDING_LEAD_IN_SECONDS +
                                  Math.min(
                                    RECORDING_LEAD_IN_SECONDS,
                                    (performance.now() - startedAt) / 1000,
                                  ),
                              )
                            }}
                            onRecordingStop={(automatic) => {
                              stopMedia()
                              setLiveTake(null)
                              if (automatic)
                                setPlaybackSeconds(
                                  selected.timestampSeconds + sourceDuration,
                                )
                            }}
                            onRecordingProgress={(relativeSeconds) =>
                              setPlaybackSeconds(
                                selected.timestampSeconds + relativeSeconds,
                              )
                            }
                            onRecordingSample={(elapsedSeconds, amplitude) =>
                              setLiveTake((current) =>
                                current?.dialogueId === selected.id
                                  ? appendLiveSample(
                                      current,
                                      elapsedSeconds +
                                        RECORDING_LEAD_IN_SECONDS,
                                      sourceDuration +
                                        RECORDING_LEAD_IN_SECONDS +
                                        RECORDING_TAIL_SECONDS,
                                      amplitude,
                                    )
                                  : current,
                              )
                            }
                            onPlayRecording={async () => {
                              stopMedia()
                              playbackModeRef.current = 'recording'
                              if (videoRef.current) {
                                videoRef.current.currentTime =
                                  selected.timestampSeconds
                                await videoRef.current.play()
                              }
                            }}
                            onSaveTake={window.studio.roomUploadTake}
                            onResolveTakeUrl={window.studio.roomGetTakeUrl}
                            onResolveEffectTakeUrl={
                              window.studio.roomGetEffectTakeUrl
                            }
                            voiceEffect={selectedVoiceEffect}
                            clipPosition={selectedIndex + 1}
                            clipCount={state.pack.dialogues.length}
                            canPreviousClip={Boolean(previousAssigned)}
                            canNextClip={Boolean(nextAssigned)}
                            onPreviousClip={() => {
                              if (previousAssigned) {
                                stopMedia()
                                setSelectedDialogueId(previousAssigned.id)
                              }
                            }}
                            onNextClip={() => {
                              if (nextAssigned) {
                                stopMedia()
                                setSelectedDialogueId(nextAssigned.id)
                              }
                            }}
                            onChooseRoles={() => setShowRolePicker(true)}
                            onWatchDub={openWatch}
                            dubReady={Boolean(
                              timeline?.requiredDialogueIds.length &&
                              timeline.missingDialogueIds.length === 0,
                            )}
                          />
                        )}
                        {selected && canRecord && (
                          <div className="mt-4">
                            <VoiceEffectsPanel
                              effect={selectedVoiceEffect}
                              onChange={(effect) =>
                                changeVoiceEffect(selected.id, effect)
                              }
                            />
                          </div>
                        )}
                      </aside>
                    </div>
                  </>
                )}
                {state.project && (
                  <WatchDubDialog
                    project={state.project}
                    pack={state.pack}
                    open={watchOpen}
                    onClose={() => setWatchOpen(false)}
                    fastMode={false}
                    mode="room"
                    contentVersion={watchContentVersion}
                    completedLines={
                      timeline
                        ? timeline.requiredDialogueIds.length -
                          timeline.missingDialogueIds.length
                        : 0
                    }
                    totalLines={timeline?.requiredDialogueIds.length ?? 0}
                  />
                )}
              </>
            )}
            {!state?.pack && (
              <p className="rounded border border-border p-5">
                Waiting for the Host to share a Dub Pack project.
              </p>
            )}
          </>
        )}
      </div>
      {canShowRolePicker && info && state?.pack && (
        <dialog
          ref={rolePickerRef}
          className="multiplayer-panel multiplayer-setup-dialog"
          aria-label="Choose roles"
          onCancel={(event) => {
            event.preventDefault()
            setShowRolePicker(false)
          }}
        >
          <div className="multiplayer-heading">
            <h1>CHOOSE YOUR ROLES</h1>
            <button
              type="button"
              aria-label="Close role picker"
              onClick={() => setShowRolePicker(false)}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-300">
              {error}
            </p>
          )}
          <div className="multiplayer-form">
            <div className="multiplayer-role-title">
              YOUR ROLES · SELECT ONE OR MORE
            </div>
            <div className="multiplayer-role-grid">
              {state.pack.characters.map((character) => {
                const ownerId = state.assignments[character.id]
                const mine = ownerId === info.playerId
                const unavailable = Boolean(ownerId && !mine)
                const clips = state.pack!.dialogues.filter((dialogue) =>
                  dialogue.characterIds.includes(character.id),
                ).length
                return (
                  <label
                    key={character.id}
                    className={`multiplayer-role-option ${mine ? 'selected' : ''} ${unavailable ? 'unavailable' : ''}`}
                  >
                    <span className="multiplayer-role-avatar">
                      <RoomPackThumbnail
                        assetRef={roleImageRef(state.pack!, character.id)}
                      />
                    </span>
                    <span>
                      <strong>{character.name}</strong>
                      <small>{unavailable ? 'TAKEN' : `${clips} CLIPS`}</small>
                    </span>
                    <input
                      type="checkbox"
                      checked={mine}
                      disabled={busy || unavailable}
                      onChange={() =>
                        void run(() =>
                          mine
                            ? window.studio.roomReleaseRole(character.id)
                            : window.studio.roomClaimRole(character.id),
                        )
                      }
                    />
                  </label>
                )
              })}
            </div>
          </div>
        </dialog>
      )}
    </MainElement>
  )
}

function roleImageRef(pack: DubPack, characterId: string): string | undefined {
  return (
    pack.dialogues.find(
      (dialogue) =>
        dialogue.characterIds.includes(characterId) && dialogue.imageRef,
    )?.imageRef ??
    pack.iconRef ??
    pack.dialogues.find((dialogue) => dialogue.imageRef)?.imageRef
  )
}

function RoomPackThumbnail({ assetRef }: { assetRef?: string }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!assetRef) return
    let active = true
    void window.studio.roomGetAssetUrl(assetRef).then(
      (value) => {
        if (active) setUrl(value)
      },
      () => {
        if (active) setUrl('')
      },
    )
    return () => {
      active = false
    }
  }, [assetRef])
  return url ? <img src={url} alt="" /> : <Film aria-hidden="true" />
}
