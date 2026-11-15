import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { RecordingTakeSchema, type RecordingTake } from '@studio/shared'
import { LibraryStore } from './library-store'

const SaveTakeSchema = z.object({
  projectId: z.uuid(),
  dialogueId: z.string().min(1).max(1024),
  mimeType: z.string().min(1).max(128),
  durationSeconds: z.number().finite().nonnegative().max(3600),
  offsetSeconds: z.number().finite().min(-3600).max(3600).optional(),
})

const extensions: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
}

export function recordingPath(root: string, take: RecordingTake): string {
  return join(root, take.projectId, take.fileRef)
}

export async function saveRecording(
  root: string,
  store: LibraryStore,
  input: {
    projectId: string
    dialogueId: string
    mimeType: string
    durationSeconds: number
    offsetSeconds?: number
    bytes: Uint8Array
  },
): Promise<RecordingTake> {
  const metadata = SaveTakeSchema.parse(input)
  if (
    !(input.bytes instanceof Uint8Array) ||
    input.bytes.byteLength === 0 ||
    input.bytes.byteLength > 100 * 1024 * 1024
  )
    throw new Error('Recording must contain 1 to 100 MB of audio data')
  const extension =
    extensions[metadata.mimeType.split(';')[0].trim().toLowerCase()]
  if (!extension)
    throw new Error(`Unsupported recording format: ${metadata.mimeType}`)

  const id = randomUUID()
  const take = RecordingTakeSchema.parse({
    id,
    projectId: metadata.projectId,
    dialogueId: metadata.dialogueId,
    fileRef: `${id}.${extension}`,
    mimeType: metadata.mimeType,
    durationSeconds: metadata.durationSeconds,
    offsetSeconds: metadata.offsetSeconds ?? 0,
    createdAt: new Date().toISOString(),
    selected: true,
  })
  const file = recordingPath(root, take)
  const temporary = `${file}.tmp`
  await mkdir(join(root, take.projectId), { recursive: true })
  try {
    await writeFile(temporary, input.bytes, { flag: 'wx' })
    await rename(temporary, file)
    return await store.addTake(take)
  } catch (error) {
    await rm(temporary, { force: true })
    await rm(file, { force: true })
    throw error
  }
}
