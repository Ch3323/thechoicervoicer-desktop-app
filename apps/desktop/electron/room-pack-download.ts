import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import {
  type DubPack,
  type ImportProgress,
  RoomCodeSchema,
} from '@studio/shared'
import { LibraryStore } from './library-store'
import { readPackFolder } from './pack-files'
import { packFingerprint } from './pack-fingerprint'
import { parseLanAddress } from './room-client'

const MAX_PACK_BYTES = 8 * 1024 * 1024 * 1024
const PackFile = z.object({
  name: z
    .string()
    .regex(/^[^/\\]+\.(ogv|mp3|ogg|wav|m4a|ini|cfg|txt|png|jpe?g)$/i),
  size: z.number().int().nonnegative().max(MAX_PACK_BYTES),
})
const Manifest = z
  .object({
    fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
    title: z.string().min(1),
    files: z.array(PackFile).min(1).max(10_000),
  })
  .superRefine((manifest, context) => {
    const names = new Set(manifest.files.map((file) => file.name.toLowerCase()))
    if (
      names.size !== manifest.files.length ||
      manifest.files.reduce((sum, file) => sum + file.size, 0) > MAX_PACK_BYTES
    )
      context.addIssue({
        code: 'custom',
        message: 'Invalid room pack manifest',
      })
  })

export async function downloadRoomPack(
  address: string,
  rawCode: string,
  storageRoot: string,
  store: LibraryStore,
  onProgress?: (progress: ImportProgress) => void,
): Promise<DubPack> {
  const baseUrl = parseLanAddress(address)
  const code = RoomCodeSchema.parse(rawCode.trim().toUpperCase())
  onProgress?.({ phase: 'scanning', completedBytes: 0, totalBytes: 0 })
  const query = `code=${encodeURIComponent(code)}`
  const response = await fetch(`${baseUrl}/pack/manifest?${query}`, {
    redirect: 'error',
  })
  if (!response.ok)
    throw new Error(
      'Could not download the Host pack. Check the room code and address.',
    )
  const manifest = Manifest.parse(await response.json())
  const id = createHash('sha256')
    .update(`room:${manifest.fingerprint}`)
    .digest('hex')
    .slice(0, 24)
  const existing = await store.getPack(id)
  if (existing) {
    try {
      if (
        (await packFingerprint(existing, storageRoot)) === manifest.fingerprint
      )
        return existing
    } catch {
      /* The cached copy is incomplete; download it again. */
    }
  }
  const staging = join(storageRoot, `${id}.downloading`)
  const destination = join(storageRoot, id)
  await mkdir(storageRoot, { recursive: true })
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging)
  const totalBytes = manifest.files.reduce((sum, file) => sum + file.size, 0)
  let completedBytes = 0
  let lastProgress = 0
  try {
    for (const file of manifest.files) {
      const url = `${baseUrl}/pack/file/${encodeURIComponent(file.name)}?${query}`
      const download = await fetch(url, { redirect: 'error' })
      if (!download.ok || !download.body)
        throw new Error(`Could not download ${file.name} from the Host`)
      let fileBytes = 0
      await pipeline(
        Readable.fromWeb(
          download.body as import('node:stream/web').ReadableStream,
        ),
        new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            fileBytes += chunk.length
            completedBytes += chunk.length
            if (fileBytes > file.size || completedBytes > totalBytes)
              callback(new Error('Room pack file exceeds its advertised size'))
            else {
              if (
                Date.now() - lastProgress >= 100 ||
                completedBytes === totalBytes
              ) {
                lastProgress = Date.now()
                onProgress?.({
                  phase: 'extracting',
                  completedBytes,
                  totalBytes,
                })
              }
              callback(null, chunk)
            }
          },
        }),
        createWriteStream(join(staging, file.name)),
      )
      if (fileBytes !== file.size)
        throw new Error(`Incomplete download: ${file.name}`)
    }
    const parsedPack = await readPackFolder(
      staging,
      'zip',
      'Downloaded from room',
      id,
    )
    const pack = {
      ...parsedPack,
      metadata: { ...parsedPack.metadata, title: manifest.title },
    }
    if (
      (await packFingerprint(
        { ...pack, source: { kind: 'folder', location: staging } },
        storageRoot,
      )) !== manifest.fingerprint
    )
      throw new Error('Downloaded Dub Pack does not match the Host pack')
    onProgress?.({ phase: 'saving', completedBytes, totalBytes })
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
    await store.savePack(pack)
    return pack
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}
