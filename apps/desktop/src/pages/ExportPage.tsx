import { reportError } from '@/lib/error-toast'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, FolderOpen, Film } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import {
  buildAudioTimeline,
  type DubPack,
  type DubbingProject,
  type ExportOptions,
  type ExportResult,
  type RecordingTake,
  googleDriveExportsEnabled,
} from '@studio/shared'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

export function ExportPage() {
  const { projectId } = useParams()
  const [project, setProject] = useState<DubbingProject | null>(null)
  const [pack, setPack] = useState<DubPack | null>(null)
  const [takes, setTakes] = useState<RecordingTake[]>([])
  const [options, setOptions] = useState<ExportOptions>({
    useBackingTrack: true,
    requireComplete: true,
    backingVolume: 1,
    dubbingVolume: 1,
  })
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const [result, setResult] = useState<ExportResult | null>(null)
  const [driveConnected, setDriveConnected] = useState(false)
  const [projectUnavailable, setProjectUnavailable] = useState(false)

  useEffect(() => {
    let active = true
    if (!projectId) return
    if (googleDriveExportsEnabled)
      void window.studio.getDriveStatus().then(
        (status) => { if (active) setDriveConnected(status.connected) },
        (reason) => { if (active) reportError(reason) },
      )
    Promise.all([
      window.studio.listProjects(),
      window.studio.listPacks(),
      window.studio.listTakes(projectId),
    ]).then(
      ([projects, packs, savedTakes]) => {
        if (!active) return
        const foundProject = projects.find((item) => item.id === projectId)
        const foundPack = packs.find((item) => item.id === foundProject?.packId)
        if (!foundProject || !foundPack) {
          setProjectUnavailable(true)
          reportError('Project or Dub Pack could not be found.')
          return
        }
        setProject(foundProject)
        setPack(foundPack)
        setTakes(savedTakes)
        setOptions((current) => ({
          ...current,
          useBackingTrack: Boolean(foundPack.backingTrackRef),
        }))
      },
      (reason) => {
        if (!active) return
        setProjectUnavailable(true)
        reportError(reason)
      },
    )
    const unsubscribe = window.studio.onExportProgress((update) => {
      if (update.projectId !== projectId || !active) return
      setProgress(update.percent)
      setMessage(update.message)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [projectId])

  const timeline = useMemo(
    () => (pack && project ? buildAudioTimeline(pack, project, takes) : null),
    [pack, project, takes],
  )

  async function startExport() {
    if (!project) return
    setBusy(true)
    setResult(null)
    setProgress(0)
    setMessage(
      driveConnected ? 'Rendering for Google Drive…' : 'Choose an output file…',
    )
    try {
      const finished = await window.studio.exportProject(project.id, options)
      if (finished) {
        setResult(finished)
        const updated = (await window.studio.listProjects()).find(
          (item) => item.id === project.id,
        )
        if (updated) setProject(updated)
      } else setMessage('Export canceled')
    } catch (reason) {
      reportError(reason)
      setMessage('Export failed')
    } finally {
      setBusy(false)
    }
  }

  async function reveal() {
    if (!project) return
    try {
      await window.studio.revealExport(project.id)
    } catch (reason) {
      reportError(reason)
    }
  }

  return (
    <div className="studio-app studio-inner-page min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-7 sm:px-10">
        <header className="border-b border-border pb-7">
          <Button asChild variant="ghost" size="sm">
            <Link to={projectId ? `/workspace/${projectId}` : '/'}>
              <ArrowLeft aria-hidden="true" /> {projectId ? 'Workspace' : 'Home'}
            </Link>
          </Button>
        </header>
        <main className="pt-12">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
            Single-player output
          </p>
          <h1 className="text-4xl font-semibold">Export video</h1>
          {!project || !pack || !timeline ? (
            <p className="mt-8 text-center text-muted-foreground">
              {projectUnavailable ? 'Project unavailable' : 'Loading project…'}
            </p>
          ) : (
            <div className="mt-9 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
              <div className="space-y-6">
                <section className="rounded-2xl border border-border bg-card p-6">
                  <div className="flex items-center gap-3">
                    <Film className="size-5 text-primary" aria-hidden="true" />
                    <h2 className="text-lg font-semibold">
                      {pack.metadata.title}
                    </h2>
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground">
                    {timeline.requiredDialogueIds.length -
                      timeline.missingDialogueIds.length}{' '}
                    of {timeline.requiredDialogueIds.length} assigned dialogue
                    lines have selected takes.
                  </p>
                  <progress
                    value={
                      timeline.requiredDialogueIds.length -
                      timeline.missingDialogueIds.length
                    }
                    max={Math.max(1, timeline.requiredDialogueIds.length)}
                    className="mt-4 h-2 w-full accent-primary"
                  />
                </section>
                <section className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="font-semibold">Export settings</h2>
                  <div className="mt-5 flex items-start gap-3 text-sm">
                    <Switch
                      checked={options.requireComplete}
                      onCheckedChange={(checked) =>
                        setOptions({ ...options, requireComplete: checked })
                      }
                      label="Require all assigned lines"
                    />
                    <span>
                      <strong>Require all assigned lines</strong>
                      <span className="mt-1 block text-muted-foreground">
                        Prevent export while any enabled role has an incomplete
                        line.
                      </span>
                    </span>
                  </div>
                  <div className="mt-5 flex items-start gap-3 text-sm">
                    <Switch
                      checked={options.useBackingTrack}
                      disabled={!pack.backingTrackRef}
                      onCheckedChange={(checked) =>
                        setOptions({ ...options, useBackingTrack: checked })
                      }
                      label="Use pack backing track"
                    />
                    <span>
                      <strong>Use pack backing track</strong>
                      <span className="mt-1 block text-muted-foreground">
                        {pack.backingTrackRef
                          ? pack.backingTrackRef
                          : 'This pack has no backing track.'}
                      </span>
                    </span>
                  </div>
                  {pack.backingTrackRef && options.useBackingTrack && (
                    <label className="mt-5 flex items-center gap-3 text-sm">
                      Backing track volume
                      <input
                        aria-label="Backing track volume"
                        type="range"
                        min="0"
                        max="200"
                        step="5"
                        value={Math.round((options.backingVolume ?? 1) * 100)}
                        onChange={(event) =>
                          setOptions({
                            ...options,
                            backingVolume: Number(event.target.value) / 100,
                          })
                        }
                        className="w-32 accent-primary"
                      />
                      {Math.round((options.backingVolume ?? 1) * 100)}%
                    </label>
                  )}
                  <label className="mt-5 flex items-center gap-3 text-sm">
                    Dubbing track volume
                    <input
                      aria-label="Dubbing track volume"
                      type="range"
                      min="0"
                      max="200"
                      step="5"
                      value={Math.round((options.dubbingVolume ?? 1) * 100)}
                      onChange={(event) =>
                        setOptions({
                          ...options,
                          dubbingVolume: Number(event.target.value) / 100,
                        })
                      }
                      className="w-32 accent-primary"
                    />
                    {Math.round((options.dubbingVolume ?? 1) * 100)}%
                  </label>
                  <p className="mt-6 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                    The source video audio is excluded so original dialogue is
                    not mixed over your takes. Without a usable backing track,
                    gaps between recordings are silent.
                  </p>
                  <Button
                    className="mt-6"
                    onClick={() => void startExport()}
                    disabled={
                      busy ||
                      (options.requireComplete &&
                        timeline.missingDialogueIds.length > 0)
                    }
                  >
                    {busy
                      ? 'Exporting…'
                      : driveConnected
                        ? 'Export MP4 to Google Drive'
                        : 'Choose file and export MP4'}
                  </Button>
                </section>
                {(busy || result || message) && (
                  <section
                    aria-label="Export progress"
                    className="rounded-2xl border border-border bg-card p-6"
                  >
                    <h2 className="font-semibold">Export progress</h2>
                    <p className="mt-3 text-sm text-muted-foreground">
                      {message || `${progress}%`}
                    </p>
                    <progress
                      value={progress}
                      max={100}
                      className="mt-3 h-2 w-full accent-primary"
                    />
                    <p className="mt-2 text-xs text-muted-foreground">
                      {progress}%
                    </p>
                  </section>
                )}
                {result && (
                  <section className="rounded-2xl border border-primary/40 bg-primary/10 p-6">
                    <div className="flex items-center gap-2 text-primary">
                      <CheckCircle2 className="size-5" aria-hidden="true" />
                      <h2 className="font-semibold">Export complete</h2>
                    </div>
                    <p className="mt-3 break-all text-sm">
                      {result.destination === 'drive'
                        ? 'Uploaded to Google Drive'
                        : result.outputPath}
                    </p>
                    {result.warnings.map((warning) => (
                      <p key={warning} className="mt-2 text-sm text-amber-100">
                        {warning}
                      </p>
                    ))}
                    {result.destination === 'drive' ? (
                      <Button
                        className="mt-5"
                        variant="secondary"
                        onClick={() =>
                          void window.studio.openDriveExport(result.outputPath)
                        }
                      >
                        Open in Google Drive
                      </Button>
                    ) : (
                      <Button
                        className="mt-5"
                        variant="secondary"
                        onClick={() => void reveal()}
                      >
                        <FolderOpen aria-hidden="true" /> Open output folder
                      </Button>
                    )}
                  </section>
                )}
                {!result && project.lastExportPath && (
                  <Button variant="outline" onClick={() => void reveal()}>
                    <FolderOpen aria-hidden="true" /> Open last export folder
                  </Button>
                )}
              </div>
              <section
                className={`p-6${timeline.missingDialogueIds.length > 0 ? ' rounded-2xl border border-border bg-card' : ''}`}
              >
                <h2 className="font-semibold">Missing recordings</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {timeline.missingDialogueIds.length} assigned lines need a
                  selected take.
                </p>
                <div className="mt-5 max-h-[600px] space-y-2 overflow-y-auto">
                  {timeline.missingDialogueIds.map((id) => {
                    const dialogue = pack.dialogues.find(
                      (item) => item.id === id,
                    )
                    return (
                      <Link
                        key={id}
                        to={`/workspace/${project.id}`}
                        className="block rounded-lg bg-secondary p-3 text-sm hover:bg-accent"
                      >
                        <span className="text-xs text-primary">
                          {dialogue?.timestampSeconds.toFixed(2)}s
                        </span>
                        <p className="mt-1">
                          {dialogue?.caption || dialogue?.sourceRef || id}
                        </p>
                      </Link>
                    )
                  })}
                  {timeline.missingDialogueIds.length === 0 && (
                    <p className="text-center text-sm text-primary">
                      All assigned lines are complete.
                    </p>
                  )}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
