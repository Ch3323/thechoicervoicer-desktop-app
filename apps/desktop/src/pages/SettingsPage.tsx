import { useEffect, useState } from 'react'
import { ArrowLeft, Info, Moon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useUpdateStatus } from '@/hooks/useUpdateStatus'

export function SettingsPage() {
  const [version, setVersion] = useState<string>('Loading…')
  const update = useUpdateStatus()

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
    <div className="studio-app studio-inner-page min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-7 sm:px-10">
        <header className="border-b border-border pb-7">
          <Button asChild variant="ghost" size="sm">
            <Link to="/">
              <ArrowLeft aria-hidden="true" /> Home
            </Link>
          </Button>
        </header>
        <main className="pt-14">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
            Application
          </p>
          <h1 className="text-4xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-3 text-muted-foreground">
            Desktop preferences and information.
          </p>

          <div className="mt-10 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            <div className="flex items-center gap-4 p-6">
              <Moon className="size-5 text-primary" aria-hidden="true" />
              <div className="flex-1">
                <h2 className="font-medium">Appearance</h2>
                <p className="text-sm text-muted-foreground">
                  The studio uses a dark theme.
                </p>
              </div>
              <span className="text-sm text-muted-foreground">Dark</span>
            </div>
            <div className="flex items-center gap-4 p-6">
              <Info className="size-5 text-primary" aria-hidden="true" />
              <div className="flex-1">
                <h2 className="font-medium">Version</h2>
                <p className="text-sm text-muted-foreground">
                  Choicer Voicer Studio
                </p>
              </div>
              <span className="text-sm text-muted-foreground">{version}</span>
            </div>
            <div className="flex items-center gap-4 p-6">
              <Info className="size-5 text-primary" aria-hidden="true" />
              <div className="flex-1">
                <h2 className="font-medium">Updates</h2>
                <p className="text-sm text-muted-foreground">
                  {update.message ?? ({ disabled: 'Available in installed Windows releases', idle: 'Ready to check', checking: 'Checking…', available: `Version ${update.version} is available`, downloading: `Downloading… ${update.percent ?? 0}%`, downloaded: `Version ${update.version} is ready to install`, current: 'You are up to date', error: 'Update check failed' }[update.phase])}
                </p>
              </div>
              <Button size="sm" variant="outline" disabled={update.phase === 'disabled' || update.phase === 'checking' || update.phase === 'downloading'} onClick={() => void window.studio.checkForUpdates()}>Check for updates</Button>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
