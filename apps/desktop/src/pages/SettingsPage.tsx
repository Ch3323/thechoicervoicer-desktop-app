import { useEffect, useState } from 'react'
import { ArrowLeft, Info, Moon, HardDrive } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { UpdateControls } from '@/components/UpdateControls'
import { googleDriveExportsEnabled } from '@studio/shared'

export function SettingsPage() {
  const [version, setVersion] = useState<string>('Loading…')
  const [drive, setDrive] = useState<{
    connected: boolean
    folderId?: string
    clientId?: string
  } | null>(null)
  const [clientId, setClientId] = useState('')
  const [folder, setFolder] = useState('')
  const [driveBusy, setDriveBusy] = useState(false)
  const [driveError, setDriveError] = useState('')

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
    if (googleDriveExportsEnabled)
      window.studio.getDriveStatus().then(
        (value) => {
          if (active) {
            setDrive(value)
            setClientId(value.clientId ?? '')
          }
        },
        (error) => {
          if (active) setDriveError(String(error))
        },
      )
    return () => {
      active = false
    }
  }, [])

  async function connectDrive() {
    setDriveBusy(true)
    setDriveError('')
    try {
      setDrive(await window.studio.connectDrive(clientId, folder))
    } catch (error) {
      setDriveError(error instanceof Error ? error.message : String(error))
    } finally {
      setDriveBusy(false)
    }
  }

  async function disconnectDrive() {
    setDriveBusy(true)
    setDriveError('')
    try {
      await window.studio.disconnectDrive()
      setDrive({ connected: false })
    } catch (error) {
      setDriveError(error instanceof Error ? error.message : String(error))
    } finally {
      setDriveBusy(false)
    }
  }

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
            {googleDriveExportsEnabled && (
              <div className="flex items-start gap-4 p-6">
                <HardDrive
                  className="mt-1 size-5 text-primary"
                  aria-hidden="true"
                />
                <div className="flex-1 space-y-3">
                  <h2 className="font-medium">
                    Google Drive export destination
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    When connected, exported videos upload to this Drive folder
                    automatically. The temporary render is removed after upload
                    or failure.
                  </p>
                  {drive?.connected ? (
                    <>
                      <p className="text-sm">
                        Connected to folder <code>{drive.folderId}</code>
                      </p>
                      <Button
                        variant="secondary"
                        disabled={driveBusy}
                        onClick={() => void disconnectDrive()}
                      >
                        Disconnect
                      </Button>
                    </>
                  ) : (
                    <>
                      <label className="block text-sm">
                        Desktop OAuth client ID
                        <input
                          className="mt-1 w-full rounded-md border border-border bg-background p-2"
                          value={clientId}
                          onChange={(event) => setClientId(event.target.value)}
                          placeholder="…apps.googleusercontent.com"
                        />
                      </label>
                      <label className="block text-sm">
                        Drive folder link or ID
                        <input
                          className="mt-1 w-full rounded-md border border-border bg-background p-2"
                          value={folder}
                          onChange={(event) => setFolder(event.target.value)}
                          placeholder="https://drive.google.com/drive/folders/…"
                        />
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Create a Desktop OAuth client with Google Drive API
                        enabled in Google Cloud. Sign-in opens your browser.
                      </p>
                      <Button
                        disabled={
                          driveBusy || !clientId.trim() || !folder.trim()
                        }
                        onClick={() => void connectDrive()}
                      >
                        {driveBusy ? 'Connecting…' : 'Connect Google Drive'}
                      </Button>
                    </>
                  )}
                  {driveError && (
                    <p role="alert" className="text-sm text-red-300">
                      {driveError}
                    </p>
                  )}
                </div>
              </div>
            )}
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
                  The Choicer Voicer At Home
                </p>
              </div>
              <span className="text-sm text-muted-foreground">{version}</span>
            </div>
            <div className="p-0">
              <UpdateControls />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
