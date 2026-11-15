import { useEffect, useState } from 'react'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { DubPack, DubbingProject } from '@studio/shared'
import { Button } from '@/components/ui/button'
import { PackThumbnail } from '@/components/PackThumbnail'
import { ConfirmDialog } from '@/components/ConfirmDialog'

export function ProjectsPage() {
  const [projects, setProjects] = useState<DubbingProject[]>([])
  const [packs, setPacks] = useState<DubPack[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [pendingDeletion, setPendingDeletion] = useState<DubbingProject | null>(null)

  async function deleteProject(project: DubbingProject) {
    setBusyId(project.id)
    setError(null)
    try {
      await window.studio.deleteProject(project.id)
      setProjects((current) => current.filter((item) => item.id !== project.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyId(null)
    }
  }

  useEffect(() => {
    Promise.all([window.studio.listProjects(), window.studio.listPacks()]).then(
      ([projectList, packList]) => {
        setProjects(projectList)
        setPacks(packList)
      },
      (reason) => setError(String(reason)),
    )
  }, [])

  return (
    <div className="studio-app studio-inner-page min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-5xl px-6 py-7 sm:px-10">
        <header className="border-b border-border pb-7">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft aria-hidden="true" /> Home
            </Link>
          </Button>
        </header>
        <main className="pt-12">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
            Local workspaces
          </p>
          <h1 className="text-4xl font-semibold">Projects</h1>
          <p className="mt-3 text-muted-foreground">
            Continue exploring a Dub Pack and your selected roles.
          </p>
          {error && (
            <p role="alert" className="mt-6 text-red-200">
              {error}
            </p>
          )}
          {projects.length === 0 && (
            <div className="mt-10 rounded-2xl border border-dashed border-border p-8">
              <p className="text-muted-foreground">No projects yet.</p>
              <Button asChild className="mt-5">
                <Link to="/library">Browse Dub Packs</Link>
              </Button>
            </div>
          )}
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {projects.map((project) => {
              const pack = packs.find((item) => item.id === project.packId)
              return (
                <article
                  key={project.id}
                  className="rounded-2xl border border-border bg-card p-6"
                >
                  {pack && (
                    <PackThumbnail
                      packId={pack.id}
                      assetRef={
                        pack.iconRef ??
                        pack.dialogues.find((item) => item.imageRef)?.imageRef
                      }
                      className="h-32 w-full"
                    />
                  )}
                  <h2 className="mt-5 text-lg font-semibold">
                    {pack?.metadata.title ?? 'Unavailable pack'}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {project.enabledCharacterIds.length} roles enabled · Created{' '}
                    {new Date(project.createdAt).toLocaleDateString()}
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <Button asChild variant="secondary">
                      <Link to={`/workspace/${project.id}`}>Open project</Link>
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busyId === project.id}
                      onClick={() => setPendingDeletion(project)}
                    >
                      <Trash2 aria-hidden="true" /> Delete project
                    </Button>
                  </div>
                </article>
              )
            })}
          </div>
        </main>
      </div>
      {pendingDeletion && <ConfirmDialog title="Delete recording?" description="Delete this recording project and all its takes? This cannot be undone." confirmLabel="Delete project" onCancel={() => setPendingDeletion(null)} onConfirm={() => { const project = pendingDeletion; setPendingDeletion(null); void deleteProject(project) }} />}
    </div>
  )
}
