import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import {
  ONLINE_PACK_PAGE_SIZE,
  type OnlinePackActivityKind,
  type OnlinePackActivityPage,
  type OnlinePackArchiveEntry,
  type OnlinePackCategory,
  type OnlinePackDetails,
  type OnlinePackFile,
  type OnlinePackOrder,
  type OnlinePackPage,
} from '@studio/shared'
import { z } from 'zod'
import type { LibraryStore } from './library-store'
import { importZip } from './pack-files'

const categoryId = 44064
const imageOrigin = 'https://images.gamebanana.com'
const gameBananaCategoryUrl = `https://gamebanana.com/mods/cats/${categoryId}`

const category = z
  .object({ _sProfileUrl: z.string(), _sName: z.string().optional() })
  .nullish()
const name = z.object({ _sName: z.string().trim() })
const optionalText = z.string().trim().nullish()
const count = z.int().nonnegative().nullish()
const previewImage = z.object({
  _sBaseUrl: z.string(),
  _sFile: z.string(),
  _sFile530: z.string().optional(),
  _sCaption: optionalText,
})
const listing = z.object({
  _idRow: z.int().positive(),
  _sName: z.string().trim().min(1),
  _aRootCategory: category,
  _aSubCategory: category,
  _aSubmitter: name.nullish(),
  _sInitialVisibility: z.string().optional(),
  _aPreviewMedia: z
    .object({ _aImages: z.array(z.unknown()).optional() })
    .nullish(),
})
const feed = z.object({
  _aMetadata: z.object({ _bIsComplete: z.boolean() }),
  _aRecords: z.array(z.unknown()),
})

const profile = listing.extend({
  _aCategory: category,
  _aSuperCategory: category,
  _bIsPrivate: z.boolean(),
  _bIsTrashed: z.boolean(),
  _bIsWithheld: z.boolean(),
  _aWithholdNotice: z
    .object({
      _tsDateWithheld: count,
      _sType: optionalText,
      _aRulesViolated: z
        .array(
          z.object({
            _sCode: optionalText,
            _sText: optionalText,
            _sFixInstructions: optionalText,
          }),
        )
        .nullish(),
    })
    .nullish()
    .catch(undefined),
  _sText: optionalText,
  _sDescription: optionalText,
  _sVersion: optionalText,
  _sLicense: optionalText,
  _aGame: name.nullish(),
  _bIsObsolete: z.boolean().nullish(),
  _aFiles: z.array(z.unknown()).nullish(),
  _aTags: z.array(z.string()).nullish(),
  _aContentRatings: z.record(z.string(), z.string()).nullish().catch(undefined),
  _aContributingStudios: z.array(name).nullish().catch(undefined),
  _aAlternateFileSources: z
    .array(z.object({ url: z.string() }))
    .nullish()
    .catch(undefined),
  _aCredits: z
    .array(
      z.object({
        _sGroupName: z.string(),
        _aAuthors: z.array(name.extend({ _sRole: optionalText })),
      }),
    )
    .nullish()
    .catch(undefined),
  _aLicenseChecklist: z
    .record(z.string(), z.array(z.string()))
    .nullish()
    .catch(undefined),
  _tsDateAdded: count,
  _tsDateUpdated: count,
  _tsDateModified: count,
  _nViewCount: count,
  _nDownloadCount: count,
  _nLikeCount: count,
  _nSubscriberCount: count,
  _nUpdatesCount: count,
  _nPostCount: count,
  _nAllTodosCount: count,
})

const publicFile = z.object({
  _idRow: z.int().positive(),
  _sFile: z.string().trim().min(1),
  _nFilesize: z.int().positive(),
  _sDescription: optionalText,
  _tsDateAdded: count,
  _nDownloadCount: count,
  _sAvResult: optionalText,
  _bIsArchived: z.boolean().nullish(),
  _bHasContents: z.boolean().nullish(),
})

const downloadableFile = publicFile.extend({
  _sDownloadUrl: z.string(),
  _sMd5Checksum: z.string().regex(/^[a-f0-9]{32}$/i),
})

const activityEntry = z.object({
  _idRow: z.int().positive(),
  _idParentPostRow: z.int().nullish(),
  _nStatus: z.union([z.string(), z.number()]).nullish(),
  _bIsPrivate: z.boolean().nullish(),
  _bIsTrashed: z.boolean().nullish(),
  _sInitialVisibility: optionalText,
  _sName: optionalText,
  _sText: optionalText,
  _sVersion: optionalText,
  _sState: optionalText,
  _tsDateAdded: count,
  _nReplyCount: count,
  _aPoster: name.nullish(),
  _aSubmitter: name.nullish(),
  _aChangeLog: z
    .array(z.object({ cat: z.string(), text: z.string() }))
    .nullish()
    .catch(undefined),
  _aFiles: z.array(z.unknown()).nullish(),
})

type DownloadFile = Pick<OnlinePackFile, 'id' | 'name' | 'size'> & {
  checksum: string
}

export class OnlinePackTransferQueue {
  private readonly waiters = new Set<() => void>()
  private active = 0

  constructor(private readonly concurrency: number) {}

  async run<T>(
    signal: AbortSignal,
    onQueued: () => void,
    transfer: () => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted()
    if (this.active < this.concurrency) {
      this.active++
    } else {
      onQueued()
      signal.throwIfAborted()
      await new Promise<void>((resolve, reject) => {
        const start = () => {
          signal.removeEventListener('abort', cancel)
          resolve()
        }
        const cancel = () => {
          this.waiters.delete(start)
          reject(signal.reason)
        }
        this.waiters.add(start)
        signal.addEventListener('abort', cancel, { once: true })
      })
    }

    try {
      signal.throwIfAborted()
      return await transfer()
    } finally {
      const next = this.waiters.values().next().value
      if (next) {
        this.waiters.delete(next)
        next()
      } else {
        this.active--
      }
    }
  }
}

function imageUrl(raw: unknown, thumbnail: boolean): string | undefined {
  const { data: image } = previewImage.safeParse(raw)
  if (!image) return
  const file = (thumbnail && image._sFile530) || image._sFile
  const url = URL.parse(image._sBaseUrl)
  if (
    url?.origin !== imageOrigin ||
    !url.pathname.startsWith('/img/') ||
    !/^[\w.-]+\.(?:avif|gif|jpe?g|png|webp)$/i.test(file)
  )
    return
  return new URL(file, `${imageOrigin}${url.pathname.replace(/\/$/, '')}/`).href
}

async function fetchGameBananaJson(
  url: URL | string,
  signal?: AbortSignal,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(10_000)
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    redirect: 'error',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error('GameBanana is unavailable.')
  return response.json()
}

function parseCategoryId(url: string | undefined): number | undefined {
  const id = Number(
    /^https:\/\/gamebanana\.com\/mods\/cats\/([1-9]\d*)$/.exec(url ?? '')?.[1],
  )
  return Number.isSafeInteger(id) ? id : undefined
}

export async function listOnlinePackCategories(): Promise<
  OnlinePackCategory[]
> {
  const category = z.object({
    _sName: z.string().trim().min(1),
    _sUrl: z.string(),
  })
  const result = z
    .array(category)
    .parse(
      await fetchGameBananaJson(
        `https://gamebanana.com/apiv11/ModCategory/${categoryId}/SubCategories`,
      ),
    )
  return result.flatMap((entry) => {
    const id = parseCategoryId(entry._sUrl)
    return id ? [{ id, name: entry._sName }] : []
  })
}

const listingSorts: Record<OnlinePackOrder, string> = {
  oldest: 'Generic_Oldest',
  updated: 'Generic_LatestUpdated',
  'title-asc': 'Generic_Alphabetically',
  'title-desc': 'Generic_ReverseAlphabetically',
  'most-liked': 'Generic_MostLiked',
  'most-downloaded': 'Generic_MostDownloaded',
}

export async function browseOnlinePacks(
  page: number,
  filterId = categoryId,
  order?: OnlinePackOrder,
  searchTerm?: string,
): Promise<OnlinePackPage> {
  const url = new URL('https://gamebanana.com/apiv11/Mod/Index')
  url.searchParams.set('_nPage', String(page))
  url.searchParams.set('_nPerpage', String(ONLINE_PACK_PAGE_SIZE))
  url.searchParams.set('_aFilters[Generic_Category]', String(filterId))
  url.searchParams.set('_sSort', order ? listingSorts[order] : 'Generic_Newest')
  if (searchTerm)
    url.searchParams.set('_aFilters[Generic_Name]', `contains,${searchTerm}`)

  const { _aRecords, _aMetadata } = feed.parse(await fetchGameBananaJson(url))
  const packs = new Map<number, OnlinePackPage['packs'][number]>()
  for (const raw of _aRecords) {
    const { data: record } = listing.safeParse(raw)
    if (!record) continue
    if (
      record._aRootCategory?._sProfileUrl !== gameBananaCategoryUrl &&
      record._aSubCategory?._sProfileUrl !== gameBananaCategoryUrl
    )
      continue
    const subcategoryId = parseCategoryId(record._aSubCategory?._sProfileUrl)
    const selectedCategory =
      subcategoryId ?? parseCategoryId(record._aRootCategory?._sProfileUrl)
    if (filterId !== categoryId && selectedCategory !== filterId) continue
    const visibility = record._sInitialVisibility
    const hasContentNotice = visibility !== undefined && visibility !== 'show'
    packs.set(record._idRow, {
      id: record._idRow,
      title: record._sName,
      submitter: record._aSubmitter?._sName,
      thumbnailUrl:
        visibility === 'show'
          ? imageUrl(record._aPreviewMedia?._aImages?.[0], true)
          : undefined,
      hasContentNotice,
      categoryId: selectedCategory,
    })
  }
  return { packs: [...packs.values()], hasNextPage: !_aMetadata._bIsComplete }
}

function downloadUrl(fileId: number) {
  return `https://gamebanana.com/dl/${fileId}`
}

async function getProfile(packId: number, signal?: AbortSignal) {
  const record = profile.parse(
    await fetchGameBananaJson(
      `https://gamebanana.com/apiv11/Mod/${packId}/ProfilePage`,
      signal,
    ),
  )
  if (
    record._idRow !== packId ||
    record._bIsPrivate ||
    record._bIsTrashed ||
    ![
      record._aCategory,
      record._aSuperCategory,
      record._aRootCategory,
      record._aSubCategory,
    ].some((item) => item?._sProfileUrl === gameBananaCategoryUrl)
  )
    throw new Error('This GameBanana listing is unavailable.')
  return record
}

function downloadFiles(record: z.infer<typeof profile>): DownloadFile[] {
  return (record._aFiles ?? []).flatMap((raw) => {
    const { data: file } = downloadableFile.safeParse(raw)
    if (
      !file ||
      file._bIsArchived ||
      (file._sAvResult && file._sAvResult !== 'clean') ||
      file._sDownloadUrl !== downloadUrl(file._idRow)
    )
      return []
    const extension = extname(file._sFile).toLowerCase()
    if (!['.zip', '.rar', '.7z'].includes(extension)) return []
    const stem = file._sFile
      .slice(0, -extension.length)
      .replace(/[^\p{L}\p{N}_. -]/gu, '_')
      .replace(/^[. ]+|[. ]+$/g, '')
      .slice(0, 120)
    const reserved =
      /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(stem)
    return [
      {
        id: file._idRow,
        name: `${reserved ? '_' : ''}${stem || 'dub-pack'}${extension}`,
        size: file._nFilesize,
        checksum: file._sMd5Checksum.toLowerCase(),
      },
    ]
  })
}

export async function getOnlinePack(
  packId: number,
): Promise<OnlinePackDetails> {
  const record = await getProfile(packId)
  const visibility = record._sInitialVisibility
  const readable =
    !record._bIsWithheld &&
    (!visibility || visibility === 'show' || visibility === 'warn')
  const images = readable
    ? (record._aPreviewMedia?._aImages ?? []).flatMap((raw) => {
        const image = previewImage.safeParse(raw).data
        const url = imageUrl(raw, false)
        return url ? [{ url, caption: image?._sCaption || undefined }] : []
      })
    : []
  const downloadable = new Set(downloadFiles(record).map((file) => file.id))
  const permissions = [
    ['yes', 'Allowed'],
    ['ask', 'Ask permission'],
    ['no', 'Prohibited'],
  ].flatMap(([key, label]) => {
    const terms = record._aLicenseChecklist?.[key]
    return terms?.length ? [{ label, terms }] : []
  })
  return {
    id: record._idRow,
    title: record._sName,
    submitter: record._aSubmitter?._sName,
    visibility,
    categoryId: parseCategoryId(record._aCategory?._sProfileUrl),
    hasContentNotice: Boolean(visibility && visibility !== 'show'),
    ratings: Object.values(record._aContentRatings ?? {}),
    summary:
      readable && record._sText ? record._sDescription || undefined : undefined,
    descriptionHtml: readable
      ? record._sText || record._sDescription || undefined
      : undefined,
    images,
    files: (record._bIsWithheld ? [] : (record._aFiles ?? [])).flatMap(
      (raw) => {
        const file = publicFile.safeParse(raw).data
        return file
          ? [
              {
                id: file._idRow,
                name: file._sFile,
                size: file._nFilesize,
                canDownload: downloadable.has(file._idRow),
                descriptionHtml: readable
                  ? file._sDescription || undefined
                  : undefined,
                added: file._tsDateAdded || undefined,
                downloads: file._nDownloadCount ?? undefined,
                scanResult: file._sAvResult || undefined,
                archived: file._bIsArchived ?? undefined,
                hasContents: file._bHasContents ?? undefined,
              },
            ]
          : []
      },
    ),
    version: record._sVersion || undefined,
    game: record._aGame?._sName,
    category: record._aCategory?._sName,
    added: record._tsDateAdded || undefined,
    updated: record._tsDateUpdated || record._tsDateModified || undefined,
    obsolete: record._bIsObsolete ?? undefined,
    withholdNotice: record._bIsWithheld
      ? {
          date: record._aWithholdNotice?._tsDateWithheld || undefined,
          type: record._aWithholdNotice?._sType || undefined,
          rules: (record._aWithholdNotice?._aRulesViolated ?? []).map(
            (rule) => ({
              code: rule._sCode || undefined,
              descriptionHtml: rule._sText || undefined,
              fixHtml: rule._sFixInstructions || undefined,
            }),
          ),
        }
      : undefined,
    tags: record._aTags ?? [],
    credits: (record._aCredits ?? []).map((group) => ({
      group: group._sGroupName,
      authors: group._aAuthors.map((author) => ({
        name: author._sName,
        role: author._sRole || undefined,
      })),
    })),
    studios: (record._aContributingStudios ?? []).map(
      (studio) => studio._sName,
    ),
    mirrors: readable
      ? (record._aAlternateFileSources ?? []).map((source) => source.url)
      : [],
    licenseHtml: record._sLicense || undefined,
    permissions,
    counts: {
      views: record._nViewCount ?? undefined,
      downloads: record._nDownloadCount ?? undefined,
      likes: record._nLikeCount ?? undefined,
      subscribers: record._nSubscriberCount ?? undefined,
      updates: record._nUpdatesCount ?? undefined,
      comments: record._nPostCount ?? undefined,
      todos: record._nAllTodosCount ?? undefined,
    },
  }
}

const activityEndpoints = {
  updates: 'Updates',
  comments: 'Posts',
  issues: 'Issues',
  todos: 'Todos',
} satisfies Record<OnlinePackActivityKind, string>

export async function getOnlinePackActivity(
  packId: number,
  kind: OnlinePackActivityKind,
  page: number,
  parentPostId?: number,
): Promise<OnlinePackActivityPage> {
  const record = await getProfile(packId)
  if (
    record._bIsWithheld ||
    (record._sInitialVisibility &&
      !['show', 'warn'].includes(record._sInitialVisibility))
  )
    return { entries: [], hasNextPage: false }
  const endpoint = parentPostId
    ? `Post/${parentPostId}/Posts`
    : `Mod/${packId}/${activityEndpoints[kind]}`
  const url = new URL(`https://gamebanana.com/apiv11/${endpoint}`)
  url.searchParams.set('_nPage', String(page))
  const { _aRecords, _aMetadata } = feed.parse(await fetchGameBananaJson(url))
  const entries = _aRecords.flatMap((raw) => {
    const entry = activityEntry.safeParse(raw).data
    if (
      !entry ||
      entry._bIsPrivate ||
      entry._bIsTrashed ||
      (entry._nStatus != null && String(entry._nStatus) !== '0') ||
      (entry._sInitialVisibility && entry._sInitialVisibility !== 'show') ||
      (parentPostId && entry._idParentPostRow !== parentPostId)
    )
      return []
    return [
      {
        id: entry._idRow,
        title: entry._sName || undefined,
        author: entry._aPoster?._sName || entry._aSubmitter?._sName,
        added: entry._tsDateAdded || undefined,
        bodyHtml: entry._sText || undefined,
        version: entry._sVersion || undefined,
        state: entry._sState || undefined,
        replyCount: entry._nReplyCount ?? undefined,
        changes: (entry._aChangeLog ?? []).map(({ cat, text }) => ({
          category: cat,
          text,
        })),
        files: entry._aFiles?.flatMap((raw) => {
          const file = z.object({ _sFile: z.string() }).safeParse(raw).data
          return file ? [file._sFile] : []
        }),
      },
    ]
  })
  return { entries, hasNextPage: !_aMetadata._bIsComplete }
}

export async function getOnlinePackDownload(
  packId: number,
  fileId: number,
  signal?: AbortSignal,
) {
  const pack = await getProfile(packId, signal)
  const file = pack._bIsWithheld
    ? undefined
    : downloadFiles(pack).find((entry) => entry.id === fileId)
  if (!file)
    throw new Error('This archive is no longer available for direct download.')
  return { ...file, packTitle: pack._sName }
}

export async function importOnlinePackZip(
  file: Awaited<ReturnType<typeof getOnlinePackDownload>>,
  temporaryRoot: string,
  packStorage: string,
  store: LibraryStore,
  onDownloadProgress: (percent: number) => void,
  onImportProgress: (percent?: number) => void,
  signal?: AbortSignal,
) {
  const location = downloadUrl(file.id)
  const id = createHash('sha256')
    .update(`gamebanana:${file.id}:${file.size}:${file.checksum}`)
    .digest('hex')
    .slice(0, 24)
  const existing = await store.getPack(id)
  signal?.throwIfAborted()
  if (existing) return existing

  const temporaryFolder = await mkdtemp(join(temporaryRoot, 'gamebanana-'))
  try {
    const archive = join(temporaryFolder, 'pack.zip')
    await saveOnlinePackDownload(file, archive, onDownloadProgress, signal)
    onImportProgress()
    const pack = await importZip(
      archive,
      packStorage,
      ({ completedBytes, totalBytes }) =>
        onImportProgress(
          totalBytes ? Math.floor((completedBytes / totalBytes) * 100) : undefined,
        ),
      { id, location, fallbackTitle: file.packTitle },
      signal,
    )
    try {
      signal?.throwIfAborted()
      await store.savePack(pack)
    } catch (error) {
      await rm(join(packStorage, id), { recursive: true, force: true })
      throw error
    }
    return pack
  } finally {
    // The app also clears its temporary root on shutdown and startup.
    await rm(temporaryFolder, {
      recursive: true,
      force: true,
      maxRetries: 3,
    }).catch(() => undefined)
  }
}

function archiveEntries(tree: object, depth = 0): OnlinePackArchiveEntry[] {
  if (depth > 64) throw new Error('This archive has too many nested folders.')
  return Object.entries(tree).flatMap(([key, value]) => {
    if (typeof value === 'string') return value ? [{ name: value }] : []
    return value && typeof value === 'object'
      ? [{ name: key, children: archiveEntries(value, depth + 1) }]
      : []
  })
}

export async function getOnlinePackArchiveContents(
  packId: number,
  fileId: number,
): Promise<OnlinePackArchiveEntry[]> {
  const pack = await getProfile(packId)
  const files = pack._aFiles ?? []
  const hasManifest = files.some((raw) => {
    const file = publicFile.safeParse(raw).data
    return file?._idRow === fileId && file._bHasContents
  })
  if (
    pack._bIsWithheld ||
    !hasManifest ||
    (pack._sInitialVisibility &&
      !['show', 'warn'].includes(pack._sInitialVisibility))
  )
    throw new Error('GameBanana does not provide contents for this file.')

  const metadata = z
    .object({ _idRow: z.int(), _aArchiveFileTree: z.unknown() })
    .parse(
      await fetchGameBananaJson(`https://gamebanana.com/apiv13/File/${fileId}`),
    )
  const tree = metadata._aArchiveFileTree
  if (metadata._idRow !== fileId || !tree || typeof tree !== 'object')
    throw new Error('GameBanana did not return the archive contents.')
  return archiveEntries(tree)
}

const maxArchivePartSize = 8 * 1024 * 1024
const minRangedArchiveSize = 32 * 1024 * 1024
const archiveConnections = 6

async function fetchArchive(
  file: DownloadFile,
  partSize: number | undefined,
  signal: AbortSignal,
) {
  let url = new URL(downloadUrl(file.id))
  for (let hop = 0; hop < 4; hop++) {
    const headers = new Headers({ 'Accept-Encoding': 'identity' })
    if (hop > 0 && partSize)
      headers.set('Range', `bytes=0-${partSize - 1}`)
    let response = await fetch(url, { redirect: 'manual', signal, headers })
    if (headers.has('Range') && [400, 403, 416, 501].includes(response.status)) {
      await response.body?.cancel()
      headers.delete('Range')
      response = await fetch(url, { redirect: 'manual', signal, headers })
    }
    if (hop > 0 && response.ok && response.body) return { url, response }
    const next = URL.parse(response.headers.get('location') ?? '', url)
    await response.body?.cancel()
    if (
      ![301, 302, 303, 307, 308].includes(response.status) ||
      !next ||
      !/^https:\/\/(?:files|filecache[0-9]+)\.gamebanana\.com$/.test(
        next.origin,
      ) ||
      next.username ||
      next.password ||
      !next.pathname.startsWith('/mods/')
    )
      break
    url = next
  }
  throw new Error('The GameBanana download is unavailable.')
}

async function readArchivePart(
  response: Response,
  start: number,
  end: number,
  size: number,
  onBytes: (bytes: number) => void,
  signal: AbortSignal,
) {
  const encoding = response.headers.get('content-encoding')
  if (
    response.status !== 206 ||
    response.headers.get('content-range') !== `bytes ${start}-${end}/${size}` ||
    (encoding && encoding !== 'identity') ||
    !response.body
  ) {
    await response.body?.cancel()
    throw new Error('GameBanana returned an invalid archive range.')
  }
  const part = Buffer.allocUnsafe(end - start + 1)
  let offset = 0
  const reader = response.body.getReader()
  const stopReading = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', stopReading, { once: true })
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      if (offset + value.byteLength > part.length)
        throw new Error('GameBanana returned too many bytes for an archive range.')
      part.set(value, offset)
      offset += value.byteLength
      onBytes(value.byteLength)
    }
    signal.throwIfAborted()
    if (offset !== part.length)
      throw new Error('GameBanana returned an incomplete archive range.')
    return part
  } finally {
    signal.removeEventListener('abort', stopReading)
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

async function* archiveParts(
  url: URL,
  first: Response,
  size: number,
  partSize: number,
  onBytes: (bytes: number) => void,
  signal: AbortSignal,
) {
  const controller = new AbortController()
  const rangeSignal = AbortSignal.any([signal, controller.signal])
  const pending: Promise<Buffer>[] = []
  let nextStart = 0
  const queuePart = () => {
    const start = nextStart
    const end = Math.min(start + partSize, size) - 1
    nextStart = end + 1
    const response = start === 0
      ? Promise.resolve(first)
      : fetch(url, {
          redirect: 'error',
          headers: { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' },
          signal: rangeSignal,
        })
    const part = response.then((result) =>
      readArchivePart(result, start, end, size, onBytes, rangeSignal),
    )
    // A later part may fail while an earlier part is still being read.
    void part.catch((error: unknown) => controller.abort(error))
    pending.push(part)
  }
  try {
    while (pending.length < archiveConnections && nextStart < size) queuePart()
    while (pending.length) {
      const part = await pending[0]
      pending.shift()
      if (nextStart < size) queuePart()
      yield part
    }
  } catch (error) {
    throw controller.signal.reason ?? error
  } finally {
    controller.abort()
    await Promise.allSettled(pending)
  }
}

export async function saveOnlinePackDownload(
  file: DownloadFile,
  destination: string,
  onProgress: (percent: number) => void,
  cancellation?: AbortSignal,
) {
  const timeout = AbortSignal.timeout(60 * 60_000)
  const controller = new AbortController()
  const signal = AbortSignal.any(
    cancellation ? [cancellation, timeout, controller.signal] : [timeout, controller.signal],
  )
  signal.throwIfAborted()
  const temp = await mkdtemp(join(dirname(destination), '.dub-pack-'))
  const partial = join(temp, 'download')
  try {
    let transferred = 0
    let written = 0
    let lastPercent = -1
    const hash = createHash('md5')
    const reportBytes = (bytes: number) => {
      transferred += bytes
      const percent = Math.min(99, Math.floor((transferred / file.size) * 100))
      if (percent !== lastPercent) {
        lastPercent = percent
        onProgress(percent)
      }
    }
    const partSize = file.size >= minRangedArchiveSize
      ? Math.min(maxArchivePartSize, Math.ceil(file.size / archiveConnections))
      : undefined
    const { url, response } = await fetchArchive(file, partSize, signal)
    const ranged = response.status === 206 && partSize !== undefined
    await pipeline(
      ranged
        ? ({ signal: pipelineSignal = signal }: { signal?: AbortSignal } = {}) =>
            archiveParts(
              url,
              response,
              file.size,
              partSize,
              reportBytes,
              AbortSignal.any([signal, pipelineSignal]),
            )
        : Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          written += chunk.length
          if (written > file.size) {
            callback(new Error('The download is larger than expected.'))
            return
          }
          hash.update(chunk)
          if (!ranged) reportBytes(chunk.length)
          callback(null, chunk)
        },
      }),
      createWriteStream(partial, { flags: 'wx', highWaterMark: 1024 * 1024 }),
      { signal },
    )
    if (written !== file.size || hash.digest('hex') !== file.checksum)
      throw new Error('The archive did not match GameBanana’s file checksum.')
    signal.throwIfAborted()
    await rename(partial, destination)
    onProgress(100)
  } finally {
    controller.abort()
    await rm(temp, { recursive: true, force: true, maxRetries: 3 })
  }
}
