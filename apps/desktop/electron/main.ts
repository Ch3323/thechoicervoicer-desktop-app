import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  nativeTheme,
  session,
  shell,
} from 'electron'
import { basename, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { networkInterfaces, tmpdir } from 'node:os'
import { mkdir, readFile, rm, rename, writeFile } from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { z } from 'zod'
import { VoiceEffectSchema, googleDriveExportsEnabled } from '@studio/shared'
import { LibraryStore } from './library-store'
import {
  getAssetUrl,
  getTakeUrl,
  ensurePreview,
  registerMediaProtocol,
} from './media'
import { importZip } from './pack-files'
import { recordingPath, saveRecording } from './recordings'
import { exportProject } from './export'
import { getDialogueWaveform } from './waveform'
import { effectTakeUrl } from './effect-preview'
import { localPreviewTakeAudio, roomPreviewTakeAudio } from './preview-take'
import { startRoomServer } from './room-server'
import { RoomClient, parseLanAddress } from './room-client'
import { backingPreviewBytes } from './backing-preview'
import { packFingerprint } from './pack-fingerprint'
import { discoverRooms } from './room-discovery'
import { downloadRoomPack } from './room-pack-download'
import { downloadRoomTakes, saveRoomHistory } from './room-recordings'
import { registerUpdates } from './updates'
import { GoogleDrive } from './google-drive'
import {
  RecordingTakeSchema,
  DisplayNameSchema,
  RoomCodeSchema,
  RoomJoinInfoSchema,
  roomPackForLocalAssets,
  type RoomExitReason,
  type RoomState,
} from '@studio/shared'

let mainWindow: BrowserWindow | null = null
let activeWrites = 0
async function duringWrite<T>(operation: () => Promise<T>): Promise<T> {
  activeWrites++
  try {
    return await operation()
  } finally {
    activeWrites--
  }
}

function createMainWindow(): void {
  const window = new BrowserWindow({
    title: 'The Choicer Voicer At Home',
    icon: join(
      __dirname,
      '../../build',
      process.platform === 'win32' ? 'icon.ico' : 'icon.png',
    ),
    width: 1120,
    height: 760,
    minWidth: 880,
    minHeight: 640,
    backgroundColor: '#101114',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow = window
  window.once('ready-to-show', () => window.show())
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL()
    if (url !== currentUrl) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

let gotSingleInstanceLock = app.requestSingleInstanceLock()

nativeTheme.themeSource = 'dark'

if (process.platform === 'win32') {
  app.setAppUserModelId('studio.collaborative.dubbing')
}

if (!gotSingleInstanceLock && process.env.ELECTRON_RENDERER_URL) {
  const devUserData = join(
    app.getPath('userData'),
    'dev-instances',
    String(process.pid),
  )
  mkdirSync(devUserData, { recursive: true })
  app.setPath('userData', devUserData)
  gotSingleInstanceLock = app.requestSingleInstanceLock()
}

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    const userData = app.getPath('userData')
    const temporaryRoot = join(
      tmpdir(),
      `thechoicervoicer-${createHash('sha256').update(userData).digest('hex').slice(0, 24)}`,
    )
    // Clear files left by an interrupted session and caches from older versions.
    await Promise.all(
      [
        temporaryRoot,
        ...[
          'previews',
          'dub-previews',
          'effect-previews',
          'room-cache',
          'drive-export-work',
        ].map((name) => join(userData, name)),
      ].map((path) => rm(path, { recursive: true, force: true })),
    )
    await mkdir(temporaryRoot, { recursive: true })
    await session.defaultSession.clearCache()
    let cleaningTemporaryFiles = false
    app.on('will-quit', (event) => {
      if (cleaningTemporaryFiles) return
      event.preventDefault()
      cleaningTemporaryFiles = true
      void Promise.allSettled([
        rm(temporaryRoot, { recursive: true, force: true }),
        session.defaultSession.clearCache(),
      ]).then(() => app.quit())
    })
    const store = new LibraryStore(userData)
    const googleDrive = new GoogleDrive(userData)
    const packStorage = join(userData, 'packs')
    const previewStorage = join(temporaryRoot, 'previews')
    const dubPreviewStorage = join(temporaryRoot, 'dub-previews')
    const effectStorage = join(temporaryRoot, 'effect-previews')
    const recordingStorage = join(userData, 'recordings')
    const roomCacheRoot = join(temporaryRoot, 'room-cache')
    const roomCacheRecordings = join(roomCacheRoot, 'recordings')
    const roomCachePreviews = join(roomCacheRoot, 'previews')
    const roomCacheStore = new LibraryStore(roomCacheRoot)
    let roomServer: Awaited<ReturnType<typeof startRoomServer>> | null = null
    let roomClient: RoomClient | null = null
    let roomPackId: string | null = null
    const resumePath = join(userData, 'room-resume.json')
    const resumeSchema = z.object({
      baseUrl: z.string(),
      code: RoomCodeSchema,
      displayName: DisplayNameSchema,
      token: z.uuid(),
    })
    let roomResume = await readFile(resumePath, 'utf8')
      .then((contents) => resumeSchema.safeParse(JSON.parse(contents)).data)
      .catch(() => undefined)
    let resumeWrite = Promise.resolve()
    const saveRoomResume = (resume: typeof roomResume) => {
      roomResume = resume
      resumeWrite = resumeWrite
        .then(async () => {
          if (!resume) {
            await rm(resumePath, { force: true })
            return
          }
          const temporaryPath = `${resumePath}.tmp`
          await writeFile(temporaryPath, JSON.stringify(resume), { mode: 0o600 })
          await rename(temporaryPath, resumePath)
        })
        .catch((error: unknown) =>
          console.error('Could not save room rejoin details', error),
        )
      return resumeWrite
    }
    const resumeFor = (baseUrl: string, code: string, name: string) =>
      roomResume?.baseUrl === baseUrl &&
      (!code || roomResume.code === code) &&
      roomResume.displayName === name
        ? roomResume
        : undefined
    let roomRenderQueue: Promise<unknown> = Promise.resolve()
    const roomRenderControllers = new Set<AbortController>()
    const exportControllers = new Map<string, Set<AbortController>>()
    const trackExport = (projectId: string, controller: AbortController) => {
      const controllers =
        exportControllers.get(projectId) ?? new Set<AbortController>()
      controllers.add(controller)
      exportControllers.set(projectId, controllers)
      return () => {
        controllers.delete(controller)
        if (controllers.size === 0) exportControllers.delete(projectId)
      }
    }
    const exportToDrive = async (
      sourceStore: LibraryStore,
      recordingRoot: string,
      projectId: string,
      options: import('@studio/shared').ExportOptions,
      name: string,
      progressChannel: 'export:progress' | 'room:render-progress',
      signal: AbortSignal,
    ): Promise<import('@studio/shared').ExportResult> => {
      const outputRoot = join(temporaryRoot, 'drive-export-work')
      await mkdir(outputRoot, { recursive: true })
      const outputPath = join(outputRoot, `${randomUUID()}.mp4`)
      try {
        const result = await duringWrite(() =>
          exportProject(
            sourceStore,
            packStorage,
            recordingRoot,
            projectId,
            options,
            outputPath,
            (progress) =>
              mainWindow?.webContents.send(progressChannel, {
                ...progress,
                percent: Math.round(progress.percent * 0.8),
              }),
            false,
            signal,
          ),
        )
        const url = await googleDrive.upload(
          outputPath,
          name,
          signal,
          (percent) =>
            mainWindow?.webContents.send(progressChannel, {
              projectId,
              percent: 80 + Math.round(percent * 0.2),
              message: 'Uploading to Google Drive…',
            }),
        )
        mainWindow?.webContents.send(progressChannel, {
          projectId,
          percent: 100,
          message: 'Google Drive upload complete',
        })
        return { ...result, outputPath: url, destination: 'drive' }
      } finally {
        await rm(outputPath, { force: true })
      }
    }
    if (googleDriveExportsEnabled) {
      ipcMain.handle('drive:status', (event) => {
        fromMainWindow(event)
        return googleDrive.status()
      })
      ipcMain.handle(
        'drive:connect',
        (event, clientId: unknown, folder: unknown) => {
          fromMainWindow(event)
          return googleDrive.connect(
            z.string().max(300).parse(clientId),
            z.string().max(1000).parse(folder),
          )
        },
      )
      ipcMain.handle('drive:disconnect', (event) => {
        fromMainWindow(event)
        return googleDrive.disconnect()
      })
      ipcMain.handle('drive:open-export', (event, rawUrl: unknown) => {
        fromMainWindow(event)
        const url = new URL(z.string().max(1000).parse(rawUrl))
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'drive.google.com' ||
          !/^\/file\/d\/[\w-]+\/view$/.test(url.pathname)
        )
          throw new Error('Invalid Google Drive export link')
        return shell.openExternal(url.toString())
      })
    }
    const roomStateChanged = (
      state: RoomState | null,
      reason?: RoomExitReason,
    ) => {
      if (!state) {
        roomClient = null
        roomPackId = null
      }
      mainWindow?.webContents.send('room:state', state, reason)
    }
    const roomHistory = new WeakMap<
      RoomClient,
      { key: string; pending: Promise<void> }
    >()
    let historyWriteQueue = Promise.resolve()
    const queueRoomHistory = (
      client: RoomClient,
      state: RoomState,
      packId: string | null,
    ) => {
      if (
        !state.started ||
        !state.project ||
        !state.pack ||
        !state.takes.length ||
        !packId ||
        (roomServer?.code === state.code &&
          roomServer.state.project?.id === state.project.id)
      )
        return Promise.resolve()
      const key = JSON.stringify([packId, state.project, state.takes])
      const previous = roomHistory.get(client)
      if (previous?.key === key) return previous.pending
      const pending = historyWriteQueue
        .then(async () => {
          if (roomHistory.get(client)?.key !== key) return
          const pack = await store.getPack(packId)
          if (!pack) throw new Error('Import the room Dub Pack first')
          await saveRoomHistory(store, recordingStorage, state, pack, (path) =>
            client.mediaUrl(path),
          )
        })
      historyWriteQueue = pending.catch(() => undefined)
        .catch((error: unknown) => {
          if (roomHistory.get(client)?.key === key) roomHistory.delete(client)
          throw error
        })
      roomHistory.set(client, { key, pending })
      return pending
    }
    const saveLatestRoomHistory = async (client: RoomClient) => {
      const state = client.getInfo()?.state
      if (state) await queueRoomHistory(client, state, roomPackId)
      let queued = roomHistory.get(client)
      while (queued) {
        await queued.pending
        const latest = roomHistory.get(client)
        if (queued === latest) break
        queued = latest
      }
    }
    const lanAddress = (port: number) => {
      const entries = Object.values(networkInterfaces()).flatMap(
        (items) => items ?? [],
      )
      const address = entries.find(
        (item) =>
          item.family === 'IPv4' &&
          !item.internal &&
          (/^10\./.test(item.address) ||
            /^192\.168\./.test(item.address) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(item.address)),
      )?.address
      return `${address ?? '127.0.0.1'}:${port}`
    }
    registerMediaProtocol(
      store,
      packStorage,
      previewStorage,
      recordingStorage,
      dubPreviewStorage,
      effectStorage,
      (path) => {
        if (!roomClient) throw new Error('Room is unavailable')
        return roomClient.mediaUrl(path)
      },
      roomCachePreviews,
    )
    const syncRoomSnapshot = async () => {
      const client = roomClient
      const state = client?.getInfo()?.state
      if (!client || !state?.project || !state.pack || !roomPackId)
        throw new Error('Room project is unavailable')
      const projectId = z.uuid().parse(state.project.id)
      const pack = await store.getPack(roomPackId)
      if (!pack) throw new Error('Import the room Dub Pack first')
      const downloads = state.takes
        .filter((take) => take.selected)
        .map((raw) => {
          const take = RecordingTakeSchema.parse(raw)
          if (take.projectId !== projectId)
            throw new Error('Room take belongs to another project')
          return { take, sourceId: take.id }
        })
      await downloadRoomTakes(
        roomCacheRecordings,
        downloads,
        (path) => client.mediaUrl(path),
      )
      const roomPack = roomPackForLocalAssets(state.pack, pack)
      await roomCacheStore.syncRoomSnapshot(
        roomPack,
        { ...state.project, packId: pack.id, lastExportPath: undefined },
        state.takes,
      )
      return { pack, projectId }
    }
    session.defaultSession.setPermissionRequestHandler(
      (webContents, permission, callback, details) => {
        if (webContents !== mainWindow?.webContents) {
          callback(false)
          return
        }
        if (permission === 'fullscreen') {
          callback(true)
          return
        }
        if (permission !== 'media') {
          callback(false)
          return
        }
        const media = details as Electron.MediaAccessPermissionRequest
        const types = media.mediaTypes ?? []
        callback(types.includes('audio') && !types.includes('video'))
      },
    )
    session.defaultSession.setPermissionCheckHandler(
      (webContents, permission, _origin, details) =>
        webContents === mainWindow?.webContents &&
        (permission === 'fullscreen' ||
          (permission === 'media' && details.mediaType !== 'video')),
    )
    const fromMainWindow = (event: Electron.IpcMainInvokeEvent) => {
      if (event.sender !== mainWindow?.webContents)
        throw new Error('Invalid sender')
    }

    ipcMain.handle('app:get-version', (event) => {
      fromMainWindow(event)
      return app.getVersion()
    })
    ipcMain.handle('room:discover', (event) => {
      fromMainWindow(event)
      return discoverRooms()
    })
    ipcMain.handle(
      'room:create',
      async (event, displayName: unknown, port: unknown) => {
        fromMainWindow(event)
        if (roomClient || roomServer)
          throw new Error('Leave the current room first')
        const name = z.string().trim().min(1).max(32).parse(displayName)
        const parsedPort = z.number().int().min(1024).max(65535).parse(port)
        roomServer = await startRoomServer({
          store,
          packStorage,
          previewStorage,
          recordingStorage,
          effectStorage,
          port: parsedPort,
          onClosed: () => {
            roomServer = null
          },
          createPreview: async (pack) => {
            await ensurePreview(pack, packStorage, previewStorage)
          },
        })
        try {
          roomClient = new RoomClient(
            {
              address: `127.0.0.1:${parsedPort}`,
              displayAddress: lanAddress(parsedPort),
              code: roomServer.code,
              displayName: name,
              hostSecret: roomServer.hostSecret,
            },
            roomStateChanged,
          )
          return await roomClient.connect()
        } catch (error) {
          roomClient?.disconnect()
          roomClient = null
          await roomServer.close()
          roomServer = null
          throw error
        }
      },
    )
    ipcMain.handle(
      'room:join-info',
      async (event, address: unknown, code: unknown, displayName: unknown) => {
        fromMainWindow(event)
        const baseUrl = parseLanAddress(z.string().max(64).parse(address))
        const roomCode = z.string().parse(code).trim().toUpperCase()
        const validatedCode = roomCode
          ? z
              .string()
              .regex(/^[A-Z2-9]{6}$/)
              .parse(roomCode)
          : ''
        const url = new URL('/room/join-info', baseUrl)
        if (validatedCode) url.searchParams.set('code', validatedCode)
        const name = DisplayNameSchema.parse(displayName)
        url.searchParams.set('name', name)
        const resume = resumeFor(baseUrl, validatedCode, name)
        const response = await fetch(url, {
          signal: AbortSignal.timeout(5000),
          redirect: 'error',
          headers: resume
            ? { Authorization: `Bearer ${resume.token}` }
            : undefined,
        })
        if (response.status === 409) throw new Error('Name already taken')
        if (!response.ok) throw new Error('Room is unavailable')
        const details = RoomJoinInfoSchema.parse(await response.json())
        const packs = await store.listPacks()
        const matches = await Promise.all(
          packs.map(async (pack) => {
            try {
              return (await packFingerprint(pack, packStorage)) ===
                details.fingerprint
                ? { id: pack.id, title: pack.metadata.title }
                : null
            } catch {
              return null
            }
          }),
        )
        return {
          ...details,
          matchingPacks: matches.filter((pack) => pack !== null),
        }
      },
    )
    ipcMain.handle(
      'room:prepare-pack',
      async (event, address: unknown, code: unknown) => {
        fromMainWindow(event)
        if (roomClient)
          throw new Error('Leave the current room first')
        return downloadRoomPack(
          z.string().max(64).parse(address),
          z.string().parse(code),
          packStorage,
          store,
          (progress) => {
            if (!event.sender.isDestroyed())
              event.sender.send('library:import-progress', progress)
          },
        )
      },
    )
    ipcMain.handle(
      'room:join',
      async (
        event,
        address: unknown,
        code: unknown,
        displayName: unknown,
        packId: unknown,
        roleIds: unknown,
        rejoining: unknown,
      ) => {
        fromMainWindow(event)
        if (roomClient)
          throw new Error('Leave the current room first')
        const roomAddress = z.string().max(64).parse(address)
        const baseUrl = parseLanAddress(roomAddress)
        const name = DisplayNameSchema.parse(displayName)
        const roomCode = z.string().parse(code).trim().toUpperCase()
        const shouldResume = z.boolean().optional().parse(rejoining)
        const resume = shouldResume
          ? resumeFor(baseUrl, roomCode, name)
          : undefined
        if (shouldResume && !resume)
          throw new Error('Room session has expired')
        const localPack =
          packId === undefined || packId === ''
            ? null
            : await store.getPack(
                z
                  .string()
                  .regex(/^[0-9a-f]{24}$/)
                  .parse(packId),
              )
        if (packId && !localPack)
          throw new Error('Local Dub Pack is unavailable')
        const fingerprint = localPack
          ? await packFingerprint(localPack, packStorage)
          : undefined
        if (roomClient) throw new Error('Leave the current room first')
        const client: RoomClient = new RoomClient(
          {
            address: roomAddress,
            code: roomCode,
            displayName: name,
            packFingerprint: fingerprint,
            token: resume?.token,
            roleIds:
              roleIds === undefined
                ? undefined
                : z.array(z.string().min(1).max(1024)).max(64).parse(roleIds),
          },
          (state, reason) => {
            if (roomClient !== client) return
            const playerId = client.getInfo()?.playerId
            if (
              state?.players.some(
                (player) => player.id === playerId && player.connected,
              )
            ) {
              void queueRoomHistory(client, state, roomPackId).catch(
                () => undefined,
              )
            }
            if (reason && resumeFor(baseUrl, client.code, name))
              void saveRoomResume(undefined)
            roomStateChanged(state, reason)
          },
          () => saveLatestRoomHistory(client),
        )
        roomClient = client
        roomPackId = localPack?.id ?? null
        try {
          const info = await client.connect()
          const token = client.getResumeToken()
          if (roomClient === client && token)
            await saveRoomResume({
              baseUrl,
              code: client.code,
              displayName: name,
              token,
            })
          if (roomClient !== client) throw new Error('Room connection ended')
          return info
        } catch (error) {
          client.disconnect()
          throw error
        }
      },
    )
    ipcMain.handle('room:download-pack', async (event) => {
      fromMainWindow(event)
      const client = roomClient
      const info = client?.getInfo()
      if (!client || !info || info.playerId === info.state.hostPlayerId)
        throw new Error('Join a room as a guest first')
      const pack = await downloadRoomPack(
        client.address,
        client.code,
        packStorage,
        store,
        (progress) => {
          if (!event.sender.isDestroyed())
            event.sender.send('library:import-progress', progress)
        },
      )
      if (roomClient !== client) throw new Error('Room closed during download')
      const fingerprint = await packFingerprint(pack, packStorage)
      roomPackId = pack.id
      try {
        await client.request('room:pack-ready', fingerprint)
      } catch (error) {
        roomPackId = null
        throw error
      }
      return pack
    })
    ipcMain.handle('room:get', (event) => {
      fromMainWindow(event)
      return roomClient?.getInfo() ?? null
    })
    ipcMain.handle('room:copy-details', (event, kind: unknown) => {
      fromMainWindow(event)
      const detailKind = z.enum(['code', 'invite']).parse(kind)
      const info = roomClient?.getInfo()
      if (!info) throw new Error('Room is unavailable')
      clipboard.writeText(
        detailKind === 'code'
          ? info.state.code
          : `${info.address} ${info.state.code}`,
      )
    })
    ipcMain.handle(
      'room:pack',
      async (event, packId: unknown, projectId: unknown) => {
        fromMainWindow(event)
        const pack = await store.getPack(
          z
            .string()
            .regex(/^[0-9a-f]{24}$/)
            .parse(packId),
        )
        if (!pack) throw new Error('Dub Pack not found')
        if (!roomClient) throw new Error('Join a room first')
        const selectedProjectId = z.uuid().optional().parse(projectId)
        roomPackId = pack.id
        try {
          await roomClient.request(
            'room:pack',
            { packId: pack.id, projectId: selectedProjectId },
            300_000,
          )
        } catch (error) {
          roomPackId = null
          throw error
        }
      },
    )
    ipcMain.handle(
      'room:voice-effect',
      (event, dialogueId: unknown, effect: unknown) => {
        fromMainWindow(event)
        return (
          roomClient?.request('room:voice-effect', {
            dialogueId: z.string().min(1).max(1024).parse(dialogueId),
            effect: VoiceEffectSchema.parse(effect),
          }) ?? Promise.reject(new Error('Join a room first'))
        )
      },
    )
    ipcMain.handle(
      'room:take-gain',
      (event, takeId: unknown, gainDb: unknown) => {
        fromMainWindow(event)
        return (
          roomClient?.request('room:take-gain', {
            takeId: z.uuid().parse(takeId),
            gainDb: z.number().finite().min(-24).max(24).parse(gainDb),
          }) ?? Promise.reject(new Error('Join a room first'))
        )
      },
    )
    ipcMain.handle('room:claim', (event, characterId: unknown) => {
      fromMainWindow(event)
      return (
        roomClient?.request(
          'room:claim',
          z.string().min(1).max(1024).parse(characterId),
        ) ?? Promise.reject(new Error('Join a room first'))
      )
    })
    ipcMain.handle('room:release', (event, characterId: unknown) => {
      fromMainWindow(event)
      return (
        roomClient?.request(
          'room:release',
          z.string().min(1).max(1024).parse(characterId),
        ) ?? Promise.reject(new Error('Join a room first'))
      )
    })
    ipcMain.handle('room:ready', (event, ready: unknown) => {
      fromMainWindow(event)
      return (
        roomClient?.request('room:ready', z.boolean().parse(ready)) ??
        Promise.reject(new Error('Join a room first'))
      )
    })
    ipcMain.handle('room:start', (event) => {
      fromMainWindow(event)
      return (
        roomClient?.request('room:start') ??
        Promise.reject(new Error('Join a room first'))
      )
    })
    for (const action of ['room:promote', 'room:kick'] as const) {
      ipcMain.handle(action, (event, rawPlayerId: unknown) => {
        fromMainWindow(event)
        const playerId = z.uuid().parse(rawPlayerId)
        if (!roomClient) throw new Error('Join a room first')
        return roomClient.request(action, playerId)
      })
    }
    ipcMain.handle('room:leave', async (event) => {
      fromMainWindow(event)
      const client = roomClient
      if (!client) return
      let historySaved = true
      try {
        await saveLatestRoomHistory(client)
      } catch (error) {
        console.error('Could not save the latest room recording history', error)
        historySaved = false
      }
      if (roomClient !== client) return { historySaved }
      try {
        await client.request('room:leave')
        if (roomResume?.token === client.getResumeToken())
          await saveRoomResume(undefined)
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === 'Host must close the room'
        )
          throw error
        // A room that has gone offline cannot acknowledge the leave request.
      }
      client.disconnect()
      return { historySaved }
    })
    ipcMain.handle('room:close', (event) => {
      fromMainWindow(event)
      const client = roomClient
      if (!client) throw new Error('Join a room first')
      return client.request('room:close')
    })
    ipcMain.handle('room:preview', async (event) => {
      fromMainWindow(event)
      if (!roomClient || !roomPackId) throw new Error('Join a room first')
      const pack = await store.getPack(roomPackId)
      if (!pack) throw new Error('Room Dub Pack is unavailable')
      return ensurePreview(pack, packStorage, previewStorage)
    })
    ipcMain.handle('room:asset', async (event, assetRef: unknown) => {
      fromMainWindow(event)
      if (!roomClient) throw new Error('Join a room first')
      const ref = z.string().min(1).max(512).parse(assetRef)
      if (!roomPackId)
        return `studio-media://room/asset/${encodeURIComponent(ref)}`
      const pack = await store.getPack(roomPackId)
      if (!pack) throw new Error('Room Dub Pack is unavailable')
      return getAssetUrl(pack, ref)
    })
    ipcMain.handle('room:backing-bytes', async (event) => {
      fromMainWindow(event)
      const info = roomClient?.getInfo()
      if (!info?.state.pack?.backingTrackRef || !roomPackId)
        throw new Error('Room backing track is unavailable')
      const pack = await store.getPack(roomPackId)
      if (!pack) throw new Error('Room Dub Pack is unavailable')
      return backingPreviewBytes(pack, packStorage, previewStorage)
    })
    ipcMain.handle('room:take-url', (event, takeId: unknown) => {
      fromMainWindow(event)
      if (!roomClient) throw new Error('Join a room first')
      return `studio-media://room/take/${z.uuid().parse(takeId)}`
    })
    ipcMain.handle(
      'room:effect-take-url',
      (
        event,
        dialogueId: unknown,
        takeId: unknown,
        effect: unknown,
        gainDb: unknown,
      ) => {
        fromMainWindow(event)
        if (!roomClient) throw new Error('Join a room first')
        const revision = encodeURIComponent(
          JSON.stringify(VoiceEffectSchema.parse(effect)),
        )
        const level =
          gainDb === undefined
            ? 0
            : z.number().finite().min(-24).max(24).parse(gainDb)
        return `studio-media://room/effect/${encodeURIComponent(z.string().min(1).max(1024).parse(dialogueId))}/${z.uuid().parse(takeId)}?revision=${revision}&gainDb=${level}`
      },
    )
    ipcMain.handle('room:watch', async (event) => {
      fromMainWindow(event)
      const controller = new AbortController()
      roomRenderControllers.add(controller)
      const render = roomRenderQueue
        .catch(() => undefined)
        .then(async () => {
          controller.signal.throwIfAborted()
          const { projectId } = await syncRoomSnapshot()
          controller.signal.throwIfAborted()
          await mkdir(roomCachePreviews, { recursive: true })
          await duringWrite(() =>
            exportProject(
              roomCacheStore,
              packStorage,
              roomCacheRecordings,
              projectId,
              { useBackingTrack: false, requireComplete: false },
              join(roomCachePreviews, `${projectId}.mp4`),
              (progress) =>
                mainWindow?.webContents.send('room:render-progress', progress),
              false,
              controller.signal,
            ),
          )
          return `studio-media://room-local/${projectId}.mp4?revision=${Date.now()}`
        })
      roomRenderQueue = render
      try {
        return await render
      } finally {
        roomRenderControllers.delete(controller)
      }
    })
    ipcMain.handle('room:cancel-render', (event) => {
      fromMainWindow(event)
      for (const controller of roomRenderControllers) controller.abort()
    })
    ipcMain.handle('room:waveform', async (event, dialogueId: unknown) => {
      fromMainWindow(event)
      const client = roomClient
      if (!client) return null
      try {
        return await client.request(
          'room:waveform',
          z.string().min(1).max(1024).parse(dialogueId),
        )
      } catch (error) {
        // A waveform can still be decoding when the room closes. Its result is
        // no longer useful once this client has been removed.
        if (roomClient !== client) return null
        throw error
      }
    })
    ipcMain.handle('room:upload', (event, input: unknown) => {
      fromMainWindow(event)
      const validated = z
        .object({
          dialogueId: z.string().min(1).max(1024),
          mimeType: z.string().min(1).max(128),
          durationSeconds: z.number().finite().nonnegative().max(3600),
          offsetSeconds: z.number().finite().min(-3600).max(3600).optional(),
          bytes: z.instanceof(Uint8Array),
        })
        .parse(input)
      return (
        roomClient?.upload(validated) ??
        Promise.reject(new Error('Join a room first'))
      )
    })
    ipcMain.handle('room:export', async (event, rawOptions: unknown) => {
      fromMainWindow(event)
      if (!roomClient?.getInfo()?.state.started)
        throw new Error('Start the room before exporting')
      const options = z
        .object({
          useBackingTrack: z.boolean(),
          requireComplete: z.boolean(),
          backingVolume: z.number().finite().min(0).max(2).optional(),
          dubbingVolume: z.number().finite().min(0).max(2).optional(),
          fastMode: z.boolean().optional(),
        })
        .parse(rawOptions)
      const controller = new AbortController()
      roomRenderControllers.add(controller)
      try {
        const { pack, projectId } = await syncRoomSnapshot()
        controller.signal.throwIfAborted()
        const defaultName = `${pack.metadata.title.replace(/[<>:"/\\|?*]/g, '_').replace(/\p{Cc}/gu, '_') || 'dubbed-video'}.mp4`
        if (googleDriveExportsEnabled && (await googleDrive.status()).connected)
          return exportToDrive(
            roomCacheStore,
            roomCacheRecordings,
            projectId,
            options,
            defaultName,
            'room:render-progress',
            controller.signal,
          )
        const selection = await dialog.showSaveDialog(mainWindow!, {
          title: 'Export shared dub',
          defaultPath: basename(defaultName),
          filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
        })
        controller.signal.throwIfAborted()
        if (selection.canceled || !selection.filePath) return null
        const outputPath = /\.mp4$/i.test(selection.filePath)
          ? selection.filePath
          : `${selection.filePath}.mp4`
        return await duringWrite(() =>
          exportProject(
            roomCacheStore,
            packStorage,
            roomCacheRecordings,
            projectId,
            options,
            outputPath,
            (progress) =>
              mainWindow?.webContents.send('room:render-progress', progress),
            false,
            controller.signal,
          ),
        )
      } finally {
        roomRenderControllers.delete(controller)
      }
    })
    ipcMain.handle('library:list-packs', (event) => {
      fromMainWindow(event)
      return store.listPacks()
    })
    ipcMain.handle('library:get-pack', (event, packId: unknown) => {
      fromMainWindow(event)
      return store.getPack(
        z
          .string()
          .regex(/^[0-9a-f]{24}$/)
          .parse(packId),
      )
    })
    ipcMain.handle('library:import-pack', async (event) => {
      fromMainWindow(event)
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        filters: [{ name: 'ZIP archives', extensions: ['zip'] }],
        title: 'Import Dub Pack ZIP',
      })
      if (result.canceled || !result.filePaths[0]) return null
      if (!/\.zip$/i.test(result.filePaths[0]))
        throw new Error('Select a ZIP archive.')
      event.sender.send('library:import-progress', {
        phase: 'scanning',
        completedBytes: 0,
        totalBytes: 0,
      })
      const pack = await importZip(
        result.filePaths[0],
        packStorage,
        (progress) => {
          if (!event.sender.isDestroyed())
            event.sender.send('library:import-progress', progress)
        },
      )
      event.sender.send('library:import-progress', {
        phase: 'saving',
        completedBytes: 0,
        totalBytes: 0,
      })
      await store.savePack(pack)
      return pack
    })
    ipcMain.handle('library:remove-pack', async (event, packId: unknown) => {
      fromMainWindow(event)
      const id = z
        .string()
        .regex(/^[0-9a-f]{24}$/)
        .parse(packId)
      const { pack, projectIds } = await store.removePack(id)
      await Promise.all(
        projectIds.flatMap((projectId) => [
          rm(join(recordingStorage, projectId), {
            recursive: true,
            force: true,
          }),
          rm(join(dubPreviewStorage, `${projectId}.mp4`), { force: true }),
          rm(join(effectStorage, projectId), { recursive: true, force: true }),
        ]),
      )
      if (pack.source.kind === 'zip')
        await rm(join(packStorage, id), { recursive: true, force: true })
      await rm(join(previewStorage, `${id}.mp4`), { force: true })
    })
    ipcMain.handle('projects:list', (event) => {
      fromMainWindow(event)
      return store.listProjects()
    })
    ipcMain.handle('projects:create', (event, packId: unknown) => {
      fromMainWindow(event)
      return store.createProject(
        z
          .string()
          .regex(/^[0-9a-f]{24}$/)
          .parse(packId),
      )
    })
    ipcMain.handle('projects:delete', async (event, projectId: unknown) => {
      fromMainWindow(event)
      const removed = await store.deleteProject(z.uuid().parse(projectId))
      await Promise.all(
        removed.map((take) =>
          rm(recordingPath(recordingStorage, take), { force: true }),
        ),
      )
      await rm(join(recordingStorage, z.uuid().parse(projectId)), {
        recursive: true,
        force: true,
      })
      await rm(join(dubPreviewStorage, `${z.uuid().parse(projectId)}.mp4`), {
        force: true,
      })
      await rm(join(effectStorage, z.uuid().parse(projectId)), {
        recursive: true,
        force: true,
      })
    })
    ipcMain.handle(
      'projects:roles',
      (event, projectId: unknown, characterIds: unknown) => {
        fromMainWindow(event)
        return store.updateRoles(
          z.string().uuid().parse(projectId),
          z.array(z.string().max(256)).max(1000).parse(characterIds),
        )
      },
    )
    ipcMain.handle(
      'projects:voice-effect',
      (event, projectId: unknown, dialogueId: unknown, effect: unknown) => {
        fromMainWindow(event)
        return store.updateVoiceEffect(
          z.uuid().parse(projectId),
          z.string().min(1).max(1024).parse(dialogueId),
          VoiceEffectSchema.parse(effect),
        )
      },
    )
    ipcMain.handle('media:preview', async (event, packId: unknown) => {
      fromMainWindow(event)
      const pack = await store.getPack(
        z
          .string()
          .regex(/^[0-9a-f]{24}$/)
          .parse(packId),
      )
      if (!pack) throw new Error('Pack not found')
      return ensurePreview(pack, packStorage, previewStorage)
    })
    ipcMain.handle(
      'media:asset',
      async (event, packId: unknown, assetRef: unknown) => {
        fromMainWindow(event)
        const pack = await store.getPack(
          z
            .string()
            .regex(/^[0-9a-f]{24}$/)
            .parse(packId),
        )
        if (!pack) throw new Error('Pack not found')
        return getAssetUrl(pack, z.string().max(512).parse(assetRef))
      },
    )
    ipcMain.handle('media:backing-bytes', async (event, packId: unknown) => {
      fromMainWindow(event)
      const id = z
        .string()
        .regex(/^[0-9a-f]{24}$/)
        .parse(packId)
      const pack = await store.getPack(id)
      if (!pack?.backingTrackRef)
        throw new Error('Pack backing track is unavailable')
      return backingPreviewBytes(pack, packStorage, previewStorage)
    })
    ipcMain.handle('recordings:list', (event, projectId: unknown) => {
      fromMainWindow(event)
      return store.listTakes(z.uuid().parse(projectId))
    })
    ipcMain.handle('recordings:save', (event, input: unknown) => {
      fromMainWindow(event)
      const validated = z
        .object({
          projectId: z.uuid(),
          dialogueId: z.string().min(1).max(1024),
          mimeType: z.string().min(1).max(128),
          durationSeconds: z.number().finite().nonnegative(),
          offsetSeconds: z.number().finite().min(-3600).max(3600).optional(),
          bytes: z.instanceof(Uint8Array),
        })
        .parse(input)
      return duringWrite(() =>
        saveRecording(recordingStorage, store, validated),
      )
    })
    ipcMain.handle(
      'recordings:select',
      (event, projectId: unknown, dialogueId: unknown, takeId: unknown) => {
        fromMainWindow(event)
        return store.selectTake(
          z.uuid().parse(projectId),
          z.string().min(1).max(1024).parse(dialogueId),
          z.uuid().parse(takeId),
        )
      },
    )
    ipcMain.handle(
      'recordings:offset',
      (event, takeId: unknown, offsetSeconds: unknown) => {
        fromMainWindow(event)
        return store.updateTakeOffset(
          z.uuid().parse(takeId),
          z.number().finite().min(-3600).max(3600).parse(offsetSeconds),
        )
      },
    )
    ipcMain.handle(
      'recordings:gain',
      (event, takeId: unknown, gainDb: unknown) => {
        fromMainWindow(event)
        return store.updateTakeGain(
          z.uuid().parse(takeId),
          z.number().finite().min(-24).max(24).parse(gainDb),
        )
      },
    )
    ipcMain.handle('recordings:url', async (event, takeId: unknown) => {
      fromMainWindow(event)
      const id = z.uuid().parse(takeId)
      if (!(await store.getTake(id)))
        throw new Error('Recording take not found')
      return getTakeUrl(id)
    })
    ipcMain.handle(
      'recordings:preview-audio',
      (
        event,
        rawMode: unknown,
        rawProjectId: unknown,
        rawDialogueId: unknown,
        rawTakeId: unknown,
        rawEffect: unknown,
        rawGainDb: unknown,
      ) => {
        fromMainWindow(event)
        const mode = z.enum(['single', 'room']).parse(rawMode)
        const projectId = z.uuid().parse(rawProjectId)
        const dialogueId = z.string().min(1).max(1024).parse(rawDialogueId)
        const takeId = z.uuid().parse(rawTakeId)
        const effect =
          rawEffect === undefined
            ? undefined
            : VoiceEffectSchema.parse(rawEffect)
        const gainDb =
          rawGainDb === undefined
            ? 0
            : z.number().finite().min(-24).max(24).parse(rawGainDb)
        if (mode === 'room') {
          if (!roomClient) throw new Error('Join a room first')
          return roomPreviewTakeAudio(
            roomClient,
            projectId,
            dialogueId,
            takeId,
            effect,
            gainDb,
          )
        }
        return localPreviewTakeAudio(
          store,
          recordingStorage,
          effectStorage,
          projectId,
          dialogueId,
          takeId,
          effect,
          gainDb,
        )
      },
    )
    ipcMain.handle(
      'recordings:effect-url',
      (
        event,
        projectId: unknown,
        dialogueId: unknown,
        takeId: unknown,
        effect: unknown,
        gainDb: unknown,
      ) => {
        fromMainWindow(event)
        return effectTakeUrl(
          store,
          recordingStorage,
          effectStorage,
          z.uuid().parse(projectId),
          z.string().min(1).max(1024).parse(dialogueId),
          z.uuid().parse(takeId),
          VoiceEffectSchema.parse(effect),
          gainDb === undefined
            ? 0
            : z.number().finite().min(-24).max(24).parse(gainDb),
        )
      },
    )
    ipcMain.handle(
      'media:waveform',
      (event, projectId: unknown, dialogueId: unknown) => {
        fromMainWindow(event)
        return getDialogueWaveform(
          store,
          packStorage,
          recordingStorage,
          z.uuid().parse(projectId),
          z.string().min(1).max(1024).parse(dialogueId),
        )
      },
    )
    ipcMain.handle(
      'export:start',
      async (event, projectId: unknown, rawOptions: unknown) => {
        fromMainWindow(event)
        const id = z.uuid().parse(projectId)
        const options = z
          .object({
            useBackingTrack: z.boolean(),
            requireComplete: z.boolean(),
            backingVolume: z.number().finite().min(0).max(2).optional(),
            dubbingVolume: z.number().finite().min(0).max(2).optional(),
            fastMode: z.boolean().optional(),
          })
          .parse(rawOptions)
        const controller = new AbortController()
        const untrack = trackExport(id, controller)
        try {
          const project = await store.getProject(id)
          const pack = project && (await store.getPack(project.packId))
          if (!project || !pack)
            throw new Error('Project Dub Pack is unavailable')
          const defaultName = `${pack.metadata.title.replace(/[<>:"/\\|?*]/g, '_').replace(/\p{Cc}/gu, '_') || 'dubbed-video'}.mp4`
          if (
            googleDriveExportsEnabled &&
            (await googleDrive.status()).connected
          )
            return exportToDrive(
              store,
              recordingStorage,
              id,
              options,
              defaultName,
              'export:progress',
              controller.signal,
            )
          const dialogResult = await dialog.showSaveDialog(mainWindow!, {
            title: 'Export dubbed video',
            defaultPath: basename(defaultName),
            filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
          })
          controller.signal.throwIfAborted()
          if (dialogResult.canceled || !dialogResult.filePath) return null
          const outputPath = /\.mp4$/i.test(dialogResult.filePath)
            ? dialogResult.filePath
            : `${dialogResult.filePath}.mp4`
          return duringWrite(() =>
            exportProject(
              store,
              packStorage,
              recordingStorage,
              id,
              options,
              outputPath,
              (progress) => {
                mainWindow?.webContents.send('export:progress', progress)
              },
              true,
              controller.signal,
            ),
          )
        } finally {
          untrack()
        }
      },
    )
    ipcMain.handle(
      'export:preview',
      async (event, projectId: unknown, rawOptions: unknown) => {
        fromMainWindow(event)
        const id = z.uuid().parse(projectId)
        const options = z
          .object({
            useBackingTrack: z.boolean(),
            requireComplete: z.boolean(),
            backingVolume: z.number().finite().min(0).max(2).optional(),
            dubbingVolume: z.number().finite().min(0).max(2).optional(),
            fastMode: z.boolean().optional(),
          })
          .parse(rawOptions)
        const controller = new AbortController()
        const untrack = trackExport(id, controller)
        try {
          await mkdir(dubPreviewStorage, { recursive: true })
          await duringWrite(() =>
            exportProject(
              store,
              packStorage,
              recordingStorage,
              id,
              options,
              join(dubPreviewStorage, `${id}.mp4`),
              (progress) =>
                mainWindow?.webContents.send('export:progress', progress),
              false,
              controller.signal,
            ),
          )
          return `studio-media://dub/${id}.mp4?revision=${Date.now()}`
        } finally {
          untrack()
        }
      },
    )
    ipcMain.handle('export:cancel', (event, projectId: unknown) => {
      fromMainWindow(event)
      const id = z.uuid().parse(projectId)
      for (const controller of exportControllers.get(id) ?? [])
        controller.abort()
    })
    ipcMain.handle('export:reveal', async (event, projectId: unknown) => {
      fromMainWindow(event)
      const project = await store.getProject(z.uuid().parse(projectId))
      if (!project?.lastExportPath)
        throw new Error('No completed export is saved for this project')
      shell.showItemInFolder(project.lastExportPath)
    })

    registerUpdates(
      () => mainWindow,
      () => activeWrites > 0,
    )
    createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
