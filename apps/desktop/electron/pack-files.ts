import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { Transform } from 'node:stream'
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl, { type Entry, type ZipFile } from 'yauzl'
import {
  parseDubPack,
  isPackFileName,
  isPackVideoFileName,
  PackValidationError,
  type DubPack,
  type PackFile,
  type ImportProgress,
} from '@studio/shared'

const MAX_TEXT_BYTES = 1024 * 1024
const MAX_ZIP_BYTES = 8 * 1024 * 1024 * 1024
const MAX_ZIP_ENTRIES = 10_000

function packId(source: string): string {
  return createHash('sha256')
    .update(source.toLowerCase())
    .digest('hex')
    .slice(0, 24)
}

function isTextFile(name: string): boolean {
  return /\.(ini|cfg|txt)$/i.test(name)
}

async function readTextFile(path: string): Promise<string | undefined> {
  if (!isTextFile(path) || (await stat(path)).size > MAX_TEXT_BYTES)
    return undefined
  return readFile(path, 'utf8')
}

export async function readPackFolder(
  folder: string,
  sourceKind: 'folder' | 'zip',
  sourceLocation: string,
  id: string,
  fallbackTitle = basename(folder),
): Promise<DubPack> {
  const entries = await readdir(folder, { withFileTypes: true })
  const selected = entries.filter(
    (entry) => entry.isFile() && isPackFileName(entry.name),
  )
  const files = new Array<PackFile>(selected.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(8, selected.length) }, async () => {
      while (next < selected.length) {
        const index = next++
        const entry = selected[index]
        files[index] = {
          path: entry.name,
          text: await readTextFile(join(folder, entry.name)),
        }
      }
    }),
  )
  return parseDubPack({
    id,
    source: { kind: sourceKind, location: sourceLocation },
    folderName: fallbackTitle,
    files,
  })
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolveZip, reject) => {
    yauzl.open(
      path,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true },
      (error, zip) => {
        if (error || !zip)
          reject(error ?? new Error('Unable to open ZIP archive'))
        else resolveZip(zip)
      },
    )
  })
}

function entriesOf(zip: ZipFile, signal?: AbortSignal): Promise<Entry[]> {
  return new Promise((resolveEntries, reject) => {
    const entries: Entry[] = []
    let totalBytes = 0
    zip.on('entry', (entry) => {
      if (signal?.aborted) {
        reject(signal.reason)
        return
      }
      const path = entry.fileName
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000
      if (
        path.includes('\\') ||
        path.startsWith('/') ||
        path.split('/').some((part: string) => part === '..') ||
        mode === 0o120000 ||
        entry.isEncrypted()
      ) {
        reject(
          new PackValidationError('ZIP contains an unsafe or encrypted entry.'),
        )
        return
      }
      entries.push(entry)
      totalBytes += entry.uncompressedSize
      if (entries.length > MAX_ZIP_ENTRIES || totalBytes > MAX_ZIP_BYTES) {
        reject(
          new PackValidationError(
            'ZIP archive exceeds the import safety limit.',
          ),
        )
        return
      }
      zip.readEntry()
    })
    zip.once('end', () => resolveEntries(entries))
    zip.once('error', reject)
    zip.readEntry()
  })
}

function streamEntry(
  zip: ZipFile,
  entry: Entry,
): Promise<NodeJS.ReadableStream> {
  return new Promise((resolveStream, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream)
        reject(error ?? new Error('Unable to read ZIP entry'))
      else resolveStream(stream)
    })
  })
}

export async function importFolder(folder: string): Promise<DubPack> {
  const canonical = await realpath(folder)
  return readPackFolder(
    canonical,
    'folder',
    canonical,
    packId(`folder:${canonical}`),
  )
}

export async function importZip(
  archive: string,
  storageRoot: string,
  onProgress?: (progress: ImportProgress) => void,
  source?: { id: string; location: string; fallbackTitle: string },
  signal?: AbortSignal,
): Promise<DubPack> {
  signal?.throwIfAborted()
  const archivePath = resolve(archive)
  const archiveStat = await stat(archivePath)
  const id =
    source?.id ??
    packId(`zip:${archivePath}:${archiveStat.size}:${archiveStat.mtimeMs}`)
  const finalFolder = join(storageRoot, id)
  const staging = join(storageRoot, `${id}.importing`)
  await mkdir(storageRoot, { recursive: true })
  await rm(staging, { recursive: true, force: true })
  await mkdir(staging)

  try {
    signal?.throwIfAborted()
    const zip = await openZip(archivePath)
    try {
      const allEntries = await entriesOf(zip, signal)
      const videoEntries = allEntries.filter((entry) =>
        isPackVideoFileName(basename(entry.fileName)),
      )
      if (videoEntries.length !== 1)
        throw new PackValidationError(
          'ZIP must contain exactly one Dub Pack video named dub_video.<extension>.',
        )
      const prefix = dirname(videoEntries[0].fileName).replace(/\\/g, '/')
      const rootPrefix = prefix === '.' ? '' : `${prefix}/`
      const selected = allEntries.filter(
        (entry) =>
          entry.fileName.startsWith(rootPrefix) &&
          !entry.fileName.slice(rootPrefix.length).includes('/') &&
          isPackFileName(basename(entry.fileName)),
      )
      const uniqueNames = new Set(
        selected.map((entry) => entry.fileName.toLowerCase()),
      )
      if (uniqueNames.size !== selected.length)
        throw new PackValidationError('ZIP has duplicate pack filenames.')

      const totalBytes = selected.reduce(
        (sum, entry) => sum + entry.uncompressedSize,
        0,
      )
      let completedBytes = 0
      let lastReport = 0
      const report = (force = false) => {
        const now = Date.now()
        if (!force && now - lastReport < 100) return
        lastReport = now
        onProgress?.({ phase: 'extracting', completedBytes, totalBytes })
      }
      report(true)

      for (const entry of selected) {
        signal?.throwIfAborted()
        const name = basename(entry.fileName)
        await pipeline(
          await streamEntry(zip, entry),
          new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              completedBytes += chunk.length
              report()
              callback(null, chunk)
            },
          }),
          createWriteStream(join(staging, name), {
            highWaterMark: 1024 * 1024,
          }),
          { signal },
        )
        report(true)
      }
    } finally {
      zip.close()
    }

    const pack = await readPackFolder(
      staging,
      'zip',
      source?.location ?? archivePath,
      id,
      source?.fallbackTitle,
    )
    signal?.throwIfAborted()
    await rm(finalFolder, { recursive: true, force: true })
    await rename(staging, finalFolder)
    return pack
  } catch (error) {
    await rm(staging, { recursive: true, force: true, maxRetries: 3 })
    throw error
  }
}

export function packAssetFolder(pack: DubPack, storageRoot: string): string {
  return pack.source.kind === 'folder'
    ? pack.source.location
    : join(storageRoot, pack.id)
}
