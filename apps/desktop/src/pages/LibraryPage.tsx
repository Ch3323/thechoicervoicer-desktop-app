import { reportError } from '@/lib/error-toast'
import { useEffect, useState } from 'react'
import { ArrowLeft, Archive, Trash2, Users } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import type { DubPack, ImportProgress } from '@studio/shared'
import { Button } from '@/components/ui/button'
import { PackThumbnail } from '@/components/PackThumbnail'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { ImportProgressDialog } from '@/components/ImportProgressDialog'

export function LibraryPage() {
  const navigate = useNavigate()
  const [packs, setPacks] = useState<DubPack[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<{
    pack: DubPack
    projectCount: number
  } | null>(null)
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(
    null,
  )

  useEffect(() => {
    window.studio
      .listPacks()
      .then(setPacks, (reason) => reportError(reason))
  }, [])

  const selected = packs.find((pack) => pack.id === selectedId) ?? packs[0]

  async function importPack() {
    setBusy(true)
    const unsubscribe = window.studio.onImportProgress(setImportProgress)
    try {
      const pack = await window.studio.importPack()
      if (pack) {
        setPacks(await window.studio.listPacks())
        setSelectedId(pack.id)
      }
    } catch (reason) {
      reportError(reason)
    } finally {
      unsubscribe()
      setImportProgress(null)
      setBusy(false)
    }
  }

  async function removePack(pack: DubPack) {
    setBusy(true)
    try {
      await window.studio.removePack(pack.id)
      setPacks(await window.studio.listPacks())
      setSelectedId(null)
    } catch (reason) {
      reportError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function confirmRemovePack(pack: DubPack) {
    if (busy) return
    try {
      const projects = await window.studio.listProjects()
      setPendingRemoval({
        pack,
        projectCount: projects.filter((project) => project.packId === pack.id)
          .length,
      })
    } catch (reason) {
      reportError(reason)
    }
  }

  async function startProject() {
    if (!selected) return
    setBusy(true)
    try {
      const project = await window.studio.createProject(selected.id)
      navigate(`/workspace/${project.id}`)
    } catch (reason) {
      reportError(reason)
      setBusy(false)
    }
  }

  return (
    <div className="studio-app studio-inner-page min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl px-6 py-7 sm:px-10">
        <header className="flex items-center justify-between border-b border-border pb-7">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft aria-hidden="true" /> Home
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link to="/projects">Open projects</Link>
          </Button>
        </header>
        <main className="pt-12">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
            Local library
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">Dub Packs</h1>
          <p className="mt-3 text-muted-foreground">
            Import a Dub Pack ZIP archive. The original archive is never
            changed.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button onClick={() => void importPack()} disabled={busy}>
              <Archive aria-hidden="true" /> Import ZIP
            </Button>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)]">
            <section aria-label="Imported packs" className="space-y-3">
              {packs.length === 0 && (
                <p className="rounded-2xl border border-dashed border-border p-8 text-sm text-muted-foreground">
                  No Dub Packs imported yet.
                </p>
              )}
              {packs.map((pack) => (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setSelectedId(pack.id)}
                  className={`w-full rounded-xl border p-5 text-left transition-colors ${selected?.id === pack.id ? 'border-primary/60 bg-primary/10' : 'border-border bg-card hover:bg-accent'}`}
                >
                  <span className="flex items-center gap-4">
                    <PackThumbnail
                      packId={pack.id}
                      assetRef={
                        pack.iconRef ??
                        pack.dialogues.find((item) => item.imageRef)?.imageRef
                      }
                      className="size-16"
                    />
                    <span>
                      <span className="block font-semibold">
                        {pack.metadata.title}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {pack.dialogues.length} dialogues ·{' '}
                        {pack.characters.length} characters
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </section>

            {selected && (
              <section
                aria-label="Pack information"
                className="rounded-2xl border border-border bg-card p-7"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-primary">
                      {selected.source.kind === 'zip'
                        ? 'ZIP archive'
                        : 'Folder'}
                    </p>
                    <h2 className="mt-2 text-2xl font-semibold">
                      {selected.metadata.title}
                    </h2>
                    {selected.metadata.subtitle && (
                      <p className="mt-2 text-muted-foreground">
                        {selected.metadata.subtitle}
                      </p>
                    )}
                  </div>
                  <PackThumbnail
                    packId={selected.id}
                    assetRef={
                      selected.iconRef ??
                      selected.dialogues.find((item) => item.imageRef)?.imageRef
                    }
                    className="size-20"
                  />
                </div>
                {selected.metadata.authors.length > 0 && (
                  <p className="mt-5 text-sm text-muted-foreground">
                    By {selected.metadata.authors.join(', ')}
                  </p>
                )}
                {selected.metadata.readme && (
                  <p className="mt-5 whitespace-pre-wrap text-sm leading-6">
                    {selected.metadata.readme}
                  </p>
                )}
                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  <InfoStat
                    label="Dialogues"
                    value={selected.dialogues.length}
                  />
                  <InfoStat
                    label="Characters"
                    value={selected.characters.length}
                  />
                  <InfoStat
                    label="Backing track"
                    value={selected.backingTrackRef ? 'Available' : 'None'}
                  />
                </div>
                <div className="mt-7 flex items-center gap-2 text-sm text-muted-foreground">
                  <Users className="size-4" aria-hidden="true" />{' '}
                  {selected.characters
                    .map((character) => character.name)
                    .join(', ')}
                </div>
                {selected.warnings.length > 0 && (
                  <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
                    <p className="font-medium">Import notes</p>
                    <ul className="mt-2 list-inside list-disc space-y-1">
                      {selected.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <div className="mt-8 flex flex-wrap gap-3">
                  <Button onClick={() => void startProject()} disabled={busy}>
                    Open as project
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void confirmRemovePack(selected)}
                    disabled={busy}
                  >
                    <Trash2 aria-hidden="true" /> Remove pack
                  </Button>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>
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
    </div>
  )
}

function InfoStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-secondary p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  )
}
