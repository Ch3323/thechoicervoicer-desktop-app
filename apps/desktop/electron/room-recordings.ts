import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, extname } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  DubbingProjectSchema,
  RecordingTakeSchema,
  roomPackForLocalAssets,
  type DubPack,
  type RecordingTake,
  type RoomState,
} from '@studio/shared'
import { LibraryStore } from './library-store'
import { recordingPath } from './recordings'

type RoomTakeDownload = { take: RecordingTake; sourceId: string }

export async function downloadRoomTakes(
  recordingRoot: string,
  downloads: RoomTakeDownload[],
  mediaUrl: (path: string) => string,
): Promise<void> {
  let nextTake = 0
  let failed = false
  const download = async () => {
    while (!failed && nextTake < downloads.length) {
      const { take, sourceId } = downloads[nextTake++]
      const path = recordingPath(recordingRoot, take)
      try {
        const existing = await stat(path)
        if (existing.isFile() && existing.size > 0) continue
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      await mkdir(dirname(path), { recursive: true })
      const response = await fetch(mediaUrl(`/media/take/${sourceId}`), {
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new Error('A room recording could not be downloaded.')
      }
      const temporary = `${path}.${randomUUID()}.download`
      let bytes = 0
      try {
        await pipeline(
          Readable.fromWeb(
            response.body as import('node:stream/web').ReadableStream,
          ),
          new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              bytes += chunk.length
              if (bytes > 100 * 1024 * 1024)
                callback(new Error('Room recording exceeds the size limit.'))
              else callback(null, chunk)
            },
          }),
          createWriteStream(temporary, { flags: 'wx' }),
        )
        if (bytes === 0) throw new Error('Room recording is empty.')
        await rename(temporary, path)
      } finally {
        await rm(temporary, { force: true })
      }
    }
  }
  const workers = await Promise.allSettled(
    Array.from({ length: Math.min(3, downloads.length) }, async () => {
      try {
        await download()
      } catch (error) {
        failed = true
        throw error
      }
    }),
  )
  const failure = workers.find((result) => result.status === 'rejected')
  if (failure) throw failure.reason
}

// Stable local UUIDs keep retries and rejoining from duplicating a saved room.
function historyId(scope: string, sourceId: string): string {
  const bytes = createHash('sha256')
    .update(JSON.stringify(['room-history', scope, sourceId]))
    .digest()
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.subarray(0, 16).toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export async function saveRoomHistory(
  store: LibraryStore,
  recordingRoot: string,
  state: RoomState,
  localPack: DubPack,
  mediaUrl: (path: string) => string,
): Promise<void> {
  if (!state.pack || !state.project || !state.takes.length) return
  const sourceProject = DubbingProjectSchema.parse(state.project)
  const roomPack = roomPackForLocalAssets(state.pack, localPack)
  const localDialogueIds = new Map(
    roomPack.dialogues.map((dialogue, index) => [
      dialogue.id,
      localPack.dialogues[index].id,
    ]),
  )
  const projectId = historyId(localPack.id, sourceProject.id)
  const voiceEffects = Object.fromEntries(
    Object.entries(sourceProject.voiceEffects ?? {}).flatMap(([id, effect]) => {
      const localId = localDialogueIds.get(id)
      return localId ? [[localId, effect]] : []
    }),
  )
  const project = DubbingProjectSchema.parse({
    ...sourceProject,
    id: projectId,
    packId: localPack.id,
    session: 'multiplayer',
    voiceEffects,
    lastExportPath: undefined,
  })
  const downloads = state.takes.map((rawTake) => {
    const take = RecordingTakeSchema.parse(rawTake)
    const dialogueId = localDialogueIds.get(take.dialogueId)
    if (take.projectId !== sourceProject.id || !dialogueId)
      throw new Error('Recording does not belong to the room project.')
    const id = historyId(projectId, take.id)
    return {
      sourceId: take.id,
      take: RecordingTakeSchema.parse({
        ...take,
        id,
        projectId,
        dialogueId,
        fileRef: `${id}${extname(take.fileRef)}`,
      }),
    }
  })
  const selected = new Set<string>()
  const ids = new Set<string>()
  for (const { take } of downloads) {
    if (ids.has(take.id) || (take.selected && selected.has(take.dialogueId)))
      throw new Error('Room recording history contains duplicate takes.')
    ids.add(take.id)
    if (take.selected) selected.add(take.dialogueId)
  }
  const selectedDownloads = downloads.filter(({ take }) => take.selected)
  await downloadRoomTakes(recordingRoot, selectedDownloads, mediaUrl)
  try {
    await downloadRoomTakes(
      recordingRoot,
      downloads.filter(({ take }) => !take.selected),
      mediaUrl,
    )
  } catch (error) {
    // Missing older audio should not prevent the current recording from saving.
    await store.saveRoomHistory(
      project,
      selectedDownloads.map(({ take }) => take),
    )
    throw error
  }
  await store.saveRoomHistory(
    project,
    downloads.map(({ take }) => take),
  )
}
