import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'
import {
  type DubPack,
  type ImportProgress,
  RoomCodeSchema,
  isPackFileName,
} from '@studio/shared'
import { LibraryStore } from './library-store'
import { readPackFolder } from './pack-files'
import { packFingerprint } from './pack-fingerprint'
import { parseLanAddress } from './room-client'

const MAX_PACK_BYTES = 8 * 1024 * 1024 * 1024
const TRANSFER_CONCURRENCY = 4
const MIN_RANGE_BYTES = 16 * 1024 * 1024
const MAX_RANGE_BYTES = 64 * 1024 * 1024
const PackFile = z.object({
  name: z
    .string()
    .refine(isPackFileName, 'Invalid pack filename'),
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
    const transfers: {
      name: string
      start: number
      end: number
      size: number
    }[] = []
    for (const file of manifest.files) {
      const handle = await open(join(staging, file.name), 'wx')
      try {
        await handle.truncate(file.size)
      } finally {
        await handle.close()
      }
      const rangeBytes = Math.min(
        MAX_RANGE_BYTES,
        Math.max(MIN_RANGE_BYTES, Math.ceil(file.size / TRANSFER_CONCURRENCY)),
      )
      for (let start = 0; start < file.size; start += rangeBytes)
        transfers.push({
          name: file.name,
          start,
          end: Math.min(start + rangeBytes, file.size) - 1,
          size: file.size,
        })
    }
    const controller = new AbortController()
    let nextTransfer = 0
    const transfer = async () => {
      while (nextTransfer < transfers.length && !controller.signal.aborted) {
        const part = transfers[nextTransfer++]
        const download = await fetch(
          `${baseUrl}/pack/file/${encodeURIComponent(part.name)}?${query}`,
          {
            redirect: 'error',
            headers: { Range: `bytes=${part.start}-${part.end}` },
            signal: controller.signal,
          },
        )
        if (
          download.status !== 206 ||
          download.headers.get('content-range') !==
            `bytes ${part.start}-${part.end}/${part.size}` ||
          !download.body
        )
          throw new Error(`Could not download ${part.name} from the Host`)
        let partBytes = 0
        await pipeline(
          Readable.fromWeb(
            download.body as import('node:stream/web').ReadableStream,
          ),
          new Transform({
            highWaterMark: 512 * 1024,
            transform(chunk: Buffer, _encoding, callback) {
              partBytes += chunk.length
              if (partBytes > part.end - part.start + 1)
                return callback(
                  new Error('Room pack file exceeds its advertised size'),
                )
              completedBytes += chunk.length
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
            },
          }),
          createWriteStream(join(staging, part.name), {
            flags: 'r+',
            start: part.start,
            highWaterMark: 512 * 1024,
          }),
          { signal: controller.signal },
        )
        if (partBytes !== part.end - part.start + 1)
          throw new Error(`Incomplete download: ${part.name}`)
      }
    }
    const workers = Array.from(
      { length: Math.min(TRANSFER_CONCURRENCY, transfers.length) },
      () =>
        transfer().catch((error: unknown) => {
          controller.abort()
          throw error
        }),
    )
    const results = await Promise.allSettled(workers)
    const failure = results.find((result) => result.status === 'rejected')
    if (failure?.status === 'rejected') throw failure.reason
    onProgress?.({ phase: 'saving', completedBytes, totalBytes })
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
      (await packFingerprint(pack, storageRoot, staging)) !== manifest.fingerprint
    )
      throw new Error('Downloaded Dub Pack does not match the Host pack')
    await rm(destination, { recursive: true, force: true })
    await rename(staging, destination)
    await store.savePack(pack)
    return pack
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}
