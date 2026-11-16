import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '@studio/shared'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export function registerUpdates(
  getWindow: () => BrowserWindow | null,
  isBusy: () => boolean,
): void {
  const enabled = app.isPackaged && process.platform === 'win32' && existsSync(join(process.resourcesPath, 'app-update.yml'))
  let status: UpdateStatus = enabled ? { phase: 'idle' } : { phase: 'disabled', message: 'Updates are available in installed Windows releases.' }
  let checking = false
  let downloading = false
  let queuedManualCheck = false
  let recording = false
  const setStatus = (next: UpdateStatus) => {
    status = next
    getWindow()?.webContents.send('updates:status', status)
  }
  const busy = () => isBusy() || recording
  const validateSender = (event: Electron.IpcMainInvokeEvent) => {
    if (event.sender !== getWindow()?.webContents) throw new Error('Invalid sender')
  }
  const check = async (manual = false) => {
    if (!enabled) {
      if (manual) setStatus({ phase: 'disabled', message: 'This build has no update feed. Install a GitHub release to check.' })
      return
    }
    if (checking) return
    if (downloading) {
      if (manual) {
        queuedManualCheck = true
        setStatus({ ...status, message: 'A new check will run after this download finishes.' })
      }
      return
    }
    const readyVersion = status.phase === 'downloaded' ? status.version : undefined
    checking = true
    setStatus({ phase: 'checking' })
    try {
      const result = await autoUpdater.checkForUpdates()
      if (readyVersion && (!result || result.updateInfo.version === readyVersion))
        setStatus({ phase: 'downloaded', version: readyVersion })
    } catch (error) {
      setStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      checking = false
    }
  }

  ipcMain.handle('updates:status', (event) => { validateSender(event); return status })
  ipcMain.handle('updates:check', async (event) => { validateSender(event); await check(true) })
  ipcMain.handle('updates:download', async (event) => {
    validateSender(event)
    if (!enabled || status.phase !== 'available' || downloading) return
    downloading = true
    setStatus({ ...status, phase: 'downloading', percent: 0 })
    try {
      await autoUpdater.downloadUpdate()
    } catch (error) {
      setStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      downloading = false
      if (queuedManualCheck) {
        queuedManualCheck = false
        void check(true)
      }
    }
  })
  ipcMain.handle('updates:recording-activity', (event, active: unknown) => {
    validateSender(event)
    if (typeof active !== 'boolean') throw new Error('Invalid recording state')
    recording = active
  })
  ipcMain.handle('updates:install', async (event) => {
    validateSender(event)
    if (!enabled || status.phase !== 'downloaded') return
    if (busy()) {
      setStatus({ ...status, message: 'Finish recording, saving, or exporting before installing.' })
      return
    }
    const window = getWindow()
    if (!window) return
    const answer = await dialog.showMessageBox(window, {
      type: 'question',
      title: 'Install update',
      message: `Install version ${status.version ?? 'the downloaded update'} and restart now?`,
      buttons: ['Install and restart', 'Later'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    })
    if (answer.response !== 0 || busy()) {
      if (busy()) setStatus({ ...status, message: 'Finish recording, saving, or exporting before installing.' })
      return
    }
    autoUpdater.quitAndInstall(false, true)
  })

  if (!enabled) return
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  autoUpdater.on('update-available', (info) => setStatus({ phase: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => setStatus({ phase: 'current' }))
  autoUpdater.on('download-progress', (progress) => setStatus({ phase: 'downloading', version: status.version, percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', (info) => setStatus({ phase: 'downloaded', version: info.version }))
  autoUpdater.on('error', (error) => setStatus({ phase: 'error', message: error.message }))
  setTimeout(() => void check(), 5000)
  const timer = setInterval(() => void check(), CHECK_INTERVAL_MS)
  app.once('before-quit', () => clearInterval(timer))
}
