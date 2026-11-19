import { reportError } from '@/lib/error-toast'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export function DriveSettings() {
  const [status, setStatus] = useState<{
    connected: boolean
    folderId?: string
  } | null>(null)
  const [clientId, setClientId] = useState('')
  const [folder, setFolder] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let active = true
    window.studio.getDriveStatus().then(
      (value) => {
        if (active) {
          setStatus(value)
          setClientId(value.clientId ?? '')
        }
      },
      (reason) => {
        if (active) reportError(reason)
      },
    )
    return () => {
      active = false
    }
  }, [])

  async function connect() {
    setBusy(true)
    try {
      setStatus(await window.studio.connectDrive(clientId, folder))
    } catch (reason) {
      reportError(reason)
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    try {
      await window.studio.disconnectDrive()
      setStatus({ connected: false })
    } catch (reason) {
      reportError(reason)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="drive-settings-panel space-y-3 text-sm">
      <strong>Google Drive exports</strong>
      <p className="text-muted-foreground">
        Upload exported videos to a Drive folder automatically. Temporary render
        files are deleted after upload.
      </p>
      {status?.connected ? (
        <>
          <p className="break-all">Connected folder: {status.folderId}</p>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => void disconnect()}
          >
            Disconnect
          </Button>
        </>
      ) : (
        <>
          <label className="block">
            Desktop OAuth client ID
            <input
              className="mt-1 w-full rounded border border-border bg-background p-2"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="…apps.googleusercontent.com"
            />
          </label>
          <label className="block">
            Drive folder link or ID
            <input
              className="mt-1 w-full rounded border border-border bg-background p-2"
              value={folder}
              onChange={(event) => setFolder(event.target.value)}
              placeholder="Drive folder link"
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Requires a Desktop OAuth client with Google Drive API enabled.
            Sign-in opens your browser.
          </p>
          <Button
            size="sm"
            disabled={busy || !clientId.trim() || !folder.trim()}
            onClick={() => void connect()}
          >
            {busy ? 'Connecting…' : 'Connect Google Drive'}
          </Button>
        </>
      )}
    </div>
  )
}
