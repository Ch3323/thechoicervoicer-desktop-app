import { playerError } from '@/lib/player-error'
import { useCallback, useEffect, useState } from 'react'
import {
  AudioLines,
  Archive,
  Box,
  FolderOpen,
  Info,
  Moon,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  buildAudioTimeline,
  type DubPack,
  type DubbingProject,
  type ImportProgress,
  type RoomState,
} from '@studio/shared'
import { Button } from '@/components/ui/button'
import { PackThumbnail } from '@/components/PackThumbnail'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ImportProgressDialog } from '@/components/ImportProgressDialog'
import { SessionTopBar } from '@/components/SessionTopBar'
import { BrandLockup } from '@/components/BrandLockup'
import { UpdateControls } from '@/components/UpdateControls'
import { DriveSettings } from '@/components/DriveSettings'
import { googleDriveExportsEnabled } from '@studio/shared'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { RoomPage } from '@/pages/RoomPage'

export function HomePage({
  session = 'single',
}: {
  session?: 'single' | 'multiplayer'
}) {
  const [activeSession, setActiveSession] = useState<'single' | 'multiplayer'>(
    'single',
  )
  const [roomInfo, setRoomInfo] = useState<{
    state: RoomState
    playerId: string
    address: string
  } | null>(null)
  const [roomModalOpen, setRoomModalOpen] = useState(session === 'multiplayer')
  const [leavingRoom, setLeavingRoom] = useState(false)
  const [confirmLeaveRoom, setConfirmLeaveRoom] = useState(false)
  const [pendingPack, setPendingPack] = useState<{
    pack: DubPack
    projectId?: string
    createNew?: boolean
  } | null>(null)
  const [packMenu, setPackMenu] = useState<{
    pack: DubPack
    x: number
    y: number
  } | null>(null)
  const [packs, setPacks] = useState<DubPack[]>([])
  const [projects, setProjects] = useState<DubbingProject[]>([])
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [sidebarSection, setSidebarSection] = useState<
    'packs' | 'recordings' | 'settings' | null
  >(null)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [pendingRemoval, setPendingRemoval] = useState<{
    pack: DubPack
    projectCount: number
  } | null>(null)
  const [pendingDeletion, setPendingDeletion] = useState<DubbingProject | null>(
    null,
  )
  const [recordingProgress, setRecordingProgress] = useState<
    Record<string, { completed: number; total: number }>
  >({})
  const [recordedProjectIds, setRecordedProjectIds] = useState<string[]>([])
  const [progressLoading, setProgressLoading] = useState(false)

  useEffect(() => {
    if (!window.studio.getRoom) return
    let active = true
    void window.studio.getRoom().then((info) => {
      if (!active || !info) return
      setRoomInfo(info)
      setActiveSession(info.state.started ? 'multiplayer' : 'single')
      if (session === 'single') setRoomModalOpen(false)
    })
    return () => {
      active = false
    }
  }, [session])

  useEffect(() => {
    let active = true
    Promise.all([window.studio.listPacks(), window.studio.listProjects()]).then(
      ([packList, projectList]) => {
        if (!active) return
        setPacks(packList)
        setProjects(projectList)
        if (window.studio.listTakes)
          void Promise.all(
            projectList.map(async (project) => ({
              id: project.id,
              hasTake: (await window.studio.listTakes(project.id)).length > 0,
            })),
          ).then(
            (entries) => {
              if (active)
                setRecordedProjectIds(
                  entries
                    .filter((entry) => entry.hasTake)
                    .map((entry) => entry.id),
                )
            },
            (reason) => {
              if (active) setError(String(reason))
            },
          )
        setActiveProjectId(
          [...projectList]
            .filter((project) => project.session !== 'multiplayer')
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ??
            null,
        )
        setLoading(false)
      },
      (reason) => {
        if (active) {
          setError(String(reason))
          setLoading(false)
        }
      },
    )
    return () => {
      active = false
    }
  }, [])

  const activeProject = projects.find(
    (project) => project.id === activeProjectId,
  )
  const activePack = packs.find((pack) => pack.id === activeProject?.packId)
  const visiblePacks = packs.filter((pack) =>
    pack.metadata.title
      .toLocaleLowerCase()
      .includes(filter.toLocaleLowerCase()),
  )
  const recordedProjects = projects.filter((project) =>
    recordedProjectIds.includes(project.id),
  )

  useEffect(() => {
    if (!packMenu) return
    const close = () => {
      if (!document.querySelector('dialog[open]')) setPackMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [packMenu])

  const handleRoomInfoChange = useCallback((info: typeof roomInfo) => {
    setRoomInfo(info)
    setActiveSession(info?.state.started ? 'multiplayer' : 'single')
  }, [])

  async function leaveRoom(): Promise<boolean> {
    if (!roomInfo || leavingRoom) return false
    setLeavingRoom(true)
    try {
      if (roomInfo.playerId === roomInfo.state.hostPlayerId)
        await window.studio.roomClose()
      else await window.studio.roomLeave()
      setRoomInfo(null)
      setActiveSession('single')
      setRoomModalOpen(false)
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
      return false
    } finally {
      setLeavingRoom(false)
    }
  }

  async function openPack(pack: DubPack, createNew = false) {
    if (busy || loading) return
    if (roomInfo) {
      setPendingPack({ pack, createNew })
      return
    }
    await loadPack(pack, createNew)
  }

  async function loadPack(pack: DubPack, createNew = false) {
    if (busy || loading) return
    setBusy(true)
    setError(null)
    try {
      const candidates = [...projects]
        .filter(
          (project) =>
            project.packId === pack.id && project.session !== 'multiplayer',
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      const recorded =
        !createNew && window.studio.listTakes
          ? await Promise.all(
              candidates.map(async (project) => ({
                project,
                hasTake: (await window.studio.listTakes(project.id)).length > 0,
              })),
            )
          : []
      const existing = createNew
        ? undefined
        : (recorded.find((item) => item.hasTake)?.project ?? candidates[0])
      const project = existing ?? (await window.studio.createProject(pack.id))
      if (!existing) setProjects((current) => [...current, project])
      setActiveProjectId(project.id)
      setSidebarSection(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  function showPackMenu(pack: DubPack, x: number, y: number) {
    if (busy || loading) return
    setPackMenu({
      pack,
      x: Math.max(0, Math.min(x, window.innerWidth - 210)),
      y: Math.max(0, Math.min(y, window.innerHeight - 126)),
    })
  }

  async function importPack() {
    if (busy || loading) return
    setBusy(true)
    setError(null)
    const unsubscribe = window.studio.onImportProgress(setImportProgress)
    try {
      const pack = await window.studio.importPack()
      if (!pack) return
      setPacks(await window.studio.listPacks())
      void window.studio.getPreviewUrl(pack.id).catch(() => undefined)
      const project = await window.studio.createProject(pack.id)
      setProjects((current) => [...current, project])
      if (roomInfo) setPendingPack({ pack, projectId: project.id })
      else {
        setActiveProjectId(project.id)
        setSidebarSection(null)
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      unsubscribe()
      setBusy(false)
      setImportProgress(null)
    }
  }

  async function removePack(pack: DubPack) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await window.studio.removePack(pack.id)
      const [nextPacks, nextProjects] = await Promise.all([
        window.studio.listPacks(),
        window.studio.listProjects(),
      ])
      setPacks(nextPacks)
      setProjects(nextProjects)
      setRecordedProjectIds((current) =>
        current.filter((id) =>
          nextProjects.some((project) => project.id === id),
        ),
      )
      if (activePack?.id === pack.id) setActiveProjectId(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function deleteProject(project: DubbingProject) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await window.studio.deleteProject(project.id)
      const remaining = projects.filter((item) => item.id !== project.id)
      setProjects(remaining)
      setRecordedProjectIds((current) =>
        current.filter((id) => id !== project.id),
      )
      setRecordingProgress((current) => {
        const next = { ...current }
        delete next[project.id]
        return next
      })
      if (activeProjectId === project.id)
        setActiveProjectId(
          [...remaining]
            .filter((item) => item.session !== 'multiplayer')
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]?.id ??
            null,
        )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function refreshRecordingProgress() {
    setProgressLoading(true)
    try {
      const [projectList, packList] = await Promise.all([
        window.studio.listProjects(),
        window.studio.listPacks(),
      ])
      const entries = await Promise.all(
        projectList.map(async (project) => {
          const pack = packList.find((item) => item.id === project.packId)
          if (!pack) return null
          const takes = await window.studio.listTakes(project.id)
          const timeline = buildAudioTimeline(pack, project, takes)
          return [
            project.id,
            {
              hasTake: takes.length > 0,
              completed:
                timeline.requiredDialogueIds.length -
                timeline.missingDialogueIds.length,
              total: timeline.requiredDialogueIds.length,
            },
          ] as const
        }),
      )
      setProjects(projectList)
      setPacks(packList)
      setRecordedProjectIds(
        entries.filter((entry) => entry?.[1].hasTake).map((entry) => entry![0]),
      )
      setRecordingProgress(
        Object.fromEntries(
          entries
            .filter((entry) => entry !== null)
            .map(([id, { completed, total }]) => [id, { completed, total }]),
        ),
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setProgressLoading(false)
    }
  }

  function toggleSidebar(section: 'packs' | 'recordings' | 'settings') {
    const next = sidebarSection === section ? null : section
    setSidebarSection(next)
    if (next === 'recordings') void refreshRecordingProgress()
  }

  return (
    <div
      className={`studio-app studio-home-shell text-foreground ${sidebarSection ? 'sidebar-open' : ''}`}
    >
      <SessionTopBar
        title={
          activeSession === 'single'
            ? activePack?.metadata.title
            : roomInfo?.state.pack?.metadata.title
        }
        roomCode={roomInfo?.state.code}
        onOpenRoom={() => setRoomModalOpen(true)}
        onLeaveRoom={roomInfo ? () => setConfirmLeaveRoom(true) : undefined}
        leavingRoom={leavingRoom}
      />
      <nav
        className="home-icon-rail !top-[68px] !h-[calc(100vh-68px)]"
        aria-label="Home menu"
      >
        <button
          type="button"
          aria-label="Packs menu"
          aria-expanded={sidebarSection === 'packs'}
          onClick={() => toggleSidebar('packs')}
        >
          <Box aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Recordings menu"
          aria-expanded={sidebarSection === 'recordings'}
          onClick={() => toggleSidebar('recordings')}
        >
          <AudioLines aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Settings menu"
          aria-expanded={sidebarSection === 'settings'}
          onClick={() => toggleSidebar('settings')}
        >
          <Settings2 aria-hidden="true" />
        </button>
      </nav>
      {sidebarSection && (
        <aside
          className="home-sidebar !top-[68px] !h-[calc(100vh-68px)]"
          aria-label="Studio sidebar"
        >
          <div className="home-sidebar-brand">
            <BrandLockup compact />
            <button
              type="button"
              onClick={() => setSidebarSection(null)}
              aria-label="Close sidebar"
              title="Close sidebar"
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <div className="home-sidebar-heading">
            <h1>
              {sidebarSection === 'packs'
                ? 'PACKS'
                : sidebarSection === 'recordings'
                  ? 'RECORDINGS'
                  : 'SETTINGS'}
            </h1>
            <span>
              {sidebarSection === 'packs'
                ? `${packs.length} PACKS`
                : sidebarSection === 'recordings'
                  ? `${recordedProjects.length} PROJECTS`
                  : 'LOCAL APP'}
            </span>
          </div>
          {sidebarSection === 'packs' && (
            <div className="home-sidebar-tools">
              <label className="home-pack-search">
                <Search aria-hidden="true" />
                <input
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter packs"
                  aria-label="Filter packs"
                />
              </label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void importPack()}
                disabled={busy || loading}
              >
                <Upload aria-hidden="true" /> Upload
              </Button>
            </div>
          )}
          <div className="home-sidebar-scroll">
            {sidebarSection === 'packs' && (
              <section
                aria-label="Imported packs"
                className="home-sidebar-section"
              >
                {visiblePacks.length === 0 && (
                  <p className="home-sidebar-empty">
                    {packs.length
                      ? 'No matching packs.'
                      : 'No packs yet. Upload a Dub Pack ZIP to begin.'}
                  </p>
                )}
                {visiblePacks.map((pack) => (
                  <article
                    key={pack.id}
                    className={`home-pack-card ${activePack?.id === pack.id ? 'active' : ''}`}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      showPackMenu(pack, event.clientX, event.clientY)
                    }}
                  >
                    <button
                      type="button"
                      className="home-pack-open"
                      onClick={() => void openPack(pack)}
                      onKeyDown={(event) => {
                        if (
                          event.key === 'ContextMenu' ||
                          (event.shiftKey && event.key === 'F10')
                        ) {
                          event.preventDefault()
                          const bounds =
                            event.currentTarget.getBoundingClientRect()
                          showPackMenu(pack, bounds.left, bounds.bottom)
                        }
                      }}
                      disabled={busy || loading}
                      aria-label={`Open ${pack.metadata.title}`}
                    >
                      <PackThumbnail
                        packId={pack.id}
                        assetRef={
                          pack.iconRef ??
                          pack.dialogues.find((item) => item.imageRef)?.imageRef
                        }
                        className="home-pack-art"
                      />
                      <span className="home-pack-copy">
                        <div>
                          <strong>{pack.metadata.title}</strong>
                          <small>
                            {pack.dialogues.length} clips ·{' '}
                            {pack.characters.length} roles
                          </small>
                        </div>
                        <small>
                          {
                            recordedProjects.filter(
                              (project) => project.packId === pack.id,
                            ).length
                          }{' '}
                          recordings
                        </small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="home-pack-delete"
                      onClick={() =>
                        setPendingRemoval({
                          pack,
                          projectCount: projects.filter(
                            (project) => project.packId === pack.id,
                          ).length,
                        })
                      }
                      disabled={busy}
                      aria-label={`Remove ${pack.metadata.title}`}
                      title="Remove pack"
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </section>
            )}
            {sidebarSection === 'recordings' && (
              <section
                aria-label="Recordings"
                className="home-sidebar-section home-recordings"
              >
                {recordedProjects.length === 0 && (
                  <p className="home-sidebar-empty">
                    No recordings yet. Record a track to add one here.
                  </p>
                )}
                {[...recordedProjects]
                  .sort(
                    (a, b) =>
                      (a.session === 'multiplayer' ? 1 : 0) -
                        (b.session === 'multiplayer' ? 1 : 0) ||
                      b.updatedAt.localeCompare(a.updatedAt),
                  )
                  .map((project, index, orderedProjects) => {
                    const pack = packs.find(
                      (item) => item.id === project.packId,
                    )
                    const progress = recordingProgress[project.id]
                    const percent = progress?.total
                      ? Math.round((progress.completed / progress.total) * 100)
                      : 0
                    return (
                      <div key={project.id}>
                        {(index === 0 ||
                          (orderedProjects[index - 1].session ===
                            'multiplayer') !==
                            (project.session === 'multiplayer')) && (
                          <h2>
                            {project.session === 'multiplayer'
                              ? 'MULTIPLAYER SESSIONS'
                              : 'SINGLEPLAYER RECORDINGS'}
                          </h2>
                        )}
                        <div
                          className={`home-recording-row ${project.id === activeProjectId ? 'active' : ''}`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (roomInfo && pack) {
                                setPendingPack({ pack, projectId: project.id })
                              } else {
                                setActiveProjectId(project.id)
                                setSidebarSection(null)
                              }
                            }}
                            disabled={busy}
                            aria-label={`Open recording ${pack?.metadata.title ?? project.id}`}
                          >
                            <span className="home-recording-summary">
                              {pack && (
                                <PackThumbnail
                                  packId={pack.id}
                                  assetRef={
                                    pack.iconRef ??
                                    pack.dialogues.find(
                                      (dialogue) => dialogue.imageRef,
                                    )?.imageRef
                                  }
                                  className="home-recording-art"
                                />
                              )}
                              <span className="home-recording-details">
                                <strong>
                                  {pack?.metadata.title ?? 'Unavailable pack'}
                                </strong>
                                <small>
                                  Updated{' '}
                                  {new Date(
                                    project.updatedAt,
                                  ).toLocaleDateString()}
                                </small>
                              </span>
                            </span>
                            <span className="home-recording-progress-copy">
                              <span>
                                {progressLoading
                                  ? 'Loading progress…'
                                  : !progress
                                    ? 'Progress unavailable'
                                    : progress.total
                                      ? `${progress.completed} / ${progress.total} lines recorded`
                                      : 'No roles selected'}
                              </span>
                              {progress && !progressLoading && (
                                <span>{percent}%</span>
                              )}
                            </span>
                            <span
                              className="home-recording-progress-track"
                              role="progressbar"
                              aria-label={`Recording progress for ${pack?.metadata.title ?? project.id}`}
                              aria-valuenow={progress?.completed ?? 0}
                              aria-valuemin={0}
                              aria-valuemax={progress?.total || 1}
                            >
                              <span style={{ width: `${percent}%` }} />
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeletion(project)}
                            disabled={busy}
                            aria-label={`Delete recording ${pack?.metadata.title ?? project.id}`}
                            title="Delete recording"
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
              </section>
            )}
            {sidebarSection === 'settings' && <HomeSettings />}
          </div>
          <div className="home-sidebar-foot">
            {sidebarSection === 'settings' ? (
              <SidebarVersion />
            ) : (
              <>
                <FolderOpen aria-hidden="true" /> YOUR FILES STAY LOCAL
              </>
            )}
          </div>
        </aside>
      )}
      <main className="home-content">
        {error && (
          <p role="alert" className="home-alert">
            {playerError(error)}
          </p>
        )}
        <div className="home-content-body">
          {activeSession === 'single' &&
            (activeProjectId && activePack ? (
              <WorkspacePage
                key={activeProjectId}
                embedded
                activeProjectId={activeProjectId}
              />
            ) : (
              <div className="home-welcome">
                <p className="eyebrow cyan">THE DUB STUDIO / READY FOR INPUT</p>
                <h2>
                  MAKE YOUR OWN <span>DUB.</span>
                </h2>
                <p>
                  Load a Dub Pack, record each line in your own voice, then
                  watch the finished dub.
                </p>
                <div className="home-welcome-monitor">
                  <Archive aria-hidden="true" />
                  <strong>YOUR SCENE STARTS HERE</strong>
                  <span>
                    Choose a pack in the sidebar or upload one from your device.
                  </span>
                  <Button
                    onClick={() => void importPack()}
                    disabled={busy || loading}
                  >
                    <Upload aria-hidden="true" /> UPLOAD DUB PACK
                  </Button>
                </div>
              </div>
            ))}
          {(roomModalOpen || roomInfo || activeSession === 'multiplayer') && (
            <RoomPage
              embedded
              modalOpen={roomModalOpen}
              onModalClose={() => setRoomModalOpen(false)}
              onRoomInfoChange={handleRoomInfoChange}
            />
          )}
        </div>
        <section
          className="studio-pack-rack home-pack-hotbar"
          aria-label="Pack hotbar"
        >
          <div className="studio-pack-rack-heading">
            <h2>YOUR PACKS</h2>
            <span>{packs.length} TAPES</span>
          </div>
          <div className="studio-pack-rack-scroll">
            {packs.map((pack) => (
              <button
                key={pack.id}
                type="button"
                className={`studio-pack-tape ${activePack?.id === pack.id ? 'in-deck' : ''}`}
                onClick={() => void openPack(pack)}
                onContextMenu={(event) => {
                  event.preventDefault()
                  showPackMenu(pack, event.clientX, event.clientY)
                }}
                onKeyDown={(event) => {
                  if (
                    event.key === 'ContextMenu' ||
                    (event.shiftKey && event.key === 'F10')
                  ) {
                    const bounds = event.currentTarget.getBoundingClientRect()
                    event.preventDefault()
                    showPackMenu(pack, bounds.left, bounds.bottom)
                  }
                }}
                disabled={busy || loading}
                aria-label={`Load ${pack.metadata.title} from hotbar`}
              >
                <span className="studio-pack-tape-face">
                  <PackThumbnail
                    packId={pack.id}
                    assetRef={
                      pack.iconRef ??
                      pack.dialogues.find((item) => item.imageRef)?.imageRef
                    }
                    className="studio-pack-tape-art"
                  />
                  <span className="studio-pack-tape-sticker">VHS</span>
                  <strong>{pack.metadata.title}</strong>
                </span>
                <span className="studio-pack-tape-foot">
                  {activePack?.id === pack.id ? (
                    <span className="studio-pack-in-deck">● IN DECK</span>
                  ) : (
                    `${pack.dialogues.length} CLIPS`
                  )}
                </span>
              </button>
            ))}
            <button
              type="button"
              className="studio-pack-upload"
              onClick={() => void importPack()}
              disabled={busy || loading}
              aria-label="Upload ZIP from hotbar"
            >
              <span className="studio-pack-upload-face">
                <span className="studio-pack-upload-sticker">NEW</span>
                <span className="studio-pack-upload-icon">
                  <Upload aria-hidden="true" />
                </span>
                <strong>UPLOAD ZIP</strong>
                <small>FROM THIS DEVICE</small>
              </span>
              <span className="studio-pack-tape-foot">CHOOSE FILE</span>
            </button>
          </div>
        </section>
      </main>
      {packMenu && (
        <div
          className="home-pack-context-menu"
          role="menu"
          aria-label={`${packMenu.pack.metadata.title} options`}
          style={{ left: packMenu.x, top: packMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const pack = packMenu.pack
              setPackMenu(null)
              void openPack(pack)
            }}
          >
            Continue recording
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const pack = packMenu.pack
              setPackMenu(null)
              void openPack(pack, true)
            }}
          >
            Create new recording
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              const pack = packMenu.pack
              setPackMenu(null)
              setPendingRemoval({
                pack,
                projectCount: projects.filter(
                  (project) => project.packId === pack.id,
                ).length,
              })
            }}
          >
            Delete pack
          </button>
        </div>
      )}
      {importProgress && <ImportProgressDialog progress={importProgress} />}
      {pendingRemoval && (
        <ConfirmDialog
          title="Remove Dub Pack?"
          description={
            pendingRemoval.projectCount > 0
              ? `Remove “${pendingRemoval.pack.metadata.title}” and delete its ${pendingRemoval.projectCount} recording ${pendingRemoval.projectCount === 1 ? 'project' : 'projects'} and all takes? This cannot be undone.`
              : `Remove “${pendingRemoval.pack.metadata.title}” from the library? This cannot be undone.`
          }
          confirmLabel="Remove pack"
          onCancel={() => setPendingRemoval(null)}
          onConfirm={() => {
            const pack = pendingRemoval.pack
            setPendingRemoval(null)
            void removePack(pack)
          }}
        />
      )}
      {pendingDeletion && (
        <ConfirmDialog
          title="Delete recording?"
          description="Delete this recording project and all its takes? This cannot be undone."
          confirmLabel="Delete recording"
          onCancel={() => setPendingDeletion(null)}
          onConfirm={() => {
            const project = pendingDeletion
            setPendingDeletion(null)
            void deleteProject(project)
          }}
        />
      )}
      {confirmLeaveRoom && (
        <ConfirmDialog
          title={
            roomInfo?.playerId === roomInfo?.state.hostPlayerId
              ? 'Leave and close room?'
              : 'Leave room?'
          }
          description={
            roomInfo?.playerId === roomInfo?.state.hostPlayerId
              ? 'Everyone will be disconnected when the host leaves.'
              : 'You will leave this multiplayer session.'
          }
          confirmLabel="Leave room"
          onCancel={() => setConfirmLeaveRoom(false)}
          onConfirm={() => {
            setConfirmLeaveRoom(false)
            void leaveRoom()
          }}
        />
      )}
      {pendingPack && (
        <ConfirmDialog
          title={
            roomInfo?.playerId === roomInfo?.state.hostPlayerId
              ? 'Leave and close room?'
              : 'Leave room?'
          }
          description={`Leave the multiplayer room and open “${pendingPack.pack.metadata.title}” in singleplayer?${roomInfo?.playerId === roomInfo?.state.hostPlayerId ? ' Everyone will be disconnected when the host leaves.' : ''}`}
          confirmLabel="Leave room"
          onCancel={() => setPendingPack(null)}
          onConfirm={() => {
            const selection = pendingPack
            setPendingPack(null)
            void (async () => {
              if (!(await leaveRoom())) return
              if (selection.projectId) {
                setActiveProjectId(selection.projectId)
                setSidebarSection(null)
              } else await loadPack(selection.pack, selection.createNew)
            })()
          }}
        />
      )}
    </div>
  )
}

function HomeSettings() {
  return (
    <section className="home-settings" aria-label="Settings panel">
      <p className="eyebrow cyan">APPLICATION</p>
      <h2>SETTINGS</h2>
      <p>Desktop preferences and information.</p>
      <div className="home-settings-list">
        <div>
          <Moon aria-hidden="true" />
          <span>
            <strong>Appearance</strong>
            <small>The studio uses a dark theme.</small>
          </span>
          <b>Dark</b>
        </div>
        <div className="!block !p-0">
          <UpdateControls compact />
        </div>
        {googleDriveExportsEnabled && (
          <div className="!block">
            <DriveSettings />
          </div>
        )}
      </div>
    </section>
  )
}

function SidebarVersion() {
  const [version, setVersion] = useState('Loading…')
  useEffect(() => {
    let active = true
    window.studio.getAppVersion().then(
      (value) => {
        if (active) setVersion(value)
      },
      () => {
        if (active) setVersion('Unavailable')
      },
    )
    return () => {
      active = false
    }
  }, [])
  return (
    <div className="flex w-full items-center gap-2" aria-label="App version">
      <Info aria-hidden="true" />
      <span>VERSION</span>
      <strong className="ml-auto text-foreground">{version}</strong>
    </div>
  )
}
