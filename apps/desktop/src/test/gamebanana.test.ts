// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import {
  browseOnlinePacks,
  getOnlinePack,
  getOnlinePackArchiveContents,
  getOnlinePackDownload,
  importOnlinePackZip,
  OnlinePackTransferQueue,
  saveOnlinePackDownload,
} from '../../electron/gamebanana'
import { LibraryStore } from '../../electron/library-store'

afterEach(() => vi.unstubAllGlobals())

it('runs multiple transfers and cancels a queued transfer without taking a slot', async () => {
  const queue = new OnlinePackTransferQueue(2)
  const signal = new AbortController().signal
  let finishFirst!: (value: string) => void
  let finishSecond!: (value: string) => void
  const first = queue.run(signal, vi.fn(), () =>
    new Promise<string>((resolve) => { finishFirst = resolve }),
  )
  const second = queue.run(signal, vi.fn(), () =>
    new Promise<string>((resolve) => { finishSecond = resolve }),
  )
  expect(finishFirst).toBeTypeOf('function')
  expect(finishSecond).toBeTypeOf('function')

  const controller = new AbortController()
  const cancelledTransfer = vi.fn(async () => 'cancelled transfer')
  const cancelled = queue.run(controller.signal, vi.fn(), cancelledTransfer)
  const waitingTransfer = vi.fn(async () => 'third')
  const onQueued = vi.fn()
  const waiting = queue.run(signal, onQueued, waitingTransfer)
  expect(onQueued).toHaveBeenCalledOnce()
  expect(waitingTransfer).not.toHaveBeenCalled()

  controller.abort()
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  finishFirst('first')
  await expect(first).resolves.toBe('first')
  await expect(waiting).resolves.toBe('third')
  expect(cancelledTransfer).not.toHaveBeenCalled()
  finishSecond('second')
  await expect(second).resolves.toBe('second')
})

it('sends the catalog search, sort, category and page to GameBanana together', async () => {
  const fetchMock = vi.fn<(url: URL) => Promise<Response>>(async () =>
    Response.json({
      _aMetadata: { _bIsComplete: true },
      _aRecords: [],
    }),
  )
  vi.stubGlobal('fetch', fetchMock)

  await browseOnlinePacks(2, 48430, 'most-downloaded', 'One & Two')

  const [url] = fetchMock.mock.calls[0]!
  expect(url.pathname).toBe('/apiv11/Mod/Index')
  expect(url.searchParams.get('_sSort')).toBe('Generic_MostDownloaded')
  expect(url.searchParams.get('_aFilters[Generic_Category]')).toBe('48430')
  expect(url.searchParams.get('_aFilters[Generic_Name]')).toBe(
    'contains,One & Two',
  )
  expect(url.searchParams.get('_nPage')).toBe('2')
  expect(url.searchParams.get('_nPerpage')).toBe('48')
})

it('only resolves an archive listed on the requested GameBanana pack', async () => {
  const response = {
    _idRow: 34,
    _sName: 'Example pack',
    _bIsPrivate: false,
    _bIsTrashed: false,
    _bIsWithheld: false,
    _aCategory: { _sProfileUrl: 'https://gamebanana.com/mods/cats/48430' },
    _aSuperCategory: { _sProfileUrl: 'https://gamebanana.com/mods/cats/44064' },
    _aFiles: [
      {
        _idRow: 55,
        _sFile: 'example.zip',
        _nFilesize: 1234,
        _sDownloadUrl: 'https://gamebanana.com/dl/55',
        _sMd5Checksum: 'ab'.repeat(16),
        _sAvResult: 'clean',
        _bHasContents: true,
      },
    ],
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(response)),
  )
  await expect(getOnlinePackDownload(34, 55)).resolves.toMatchObject({
    id: 55,
    name: 'example.zip',
  })
  await expect(getOnlinePackDownload(34, 99)).rejects.toThrow(
    /no longer available/,
  )
  await expect(getOnlinePackDownload(35, 55)).rejects.toThrow(
    /listing is unavailable/,
  )

  const archiveFetch = vi.fn(async (url: string) =>
    Response.json(
      url.endsWith('/File/55')
        ? {
            _idRow: 55,
            _aArchiveFileTree: { Pack: ['pack.json', 'preview.png'] },
          }
        : response,
    ),
  )
  vi.stubGlobal('fetch', archiveFetch)
  await expect(getOnlinePackArchiveContents(34, 99)).rejects.toThrow(
    /does not provide contents/,
  )
  expect(archiveFetch).toHaveBeenCalledTimes(1)
  await expect(getOnlinePackArchiveContents(34, 55)).resolves.toEqual([
    {
      name: 'Pack',
      children: [{ name: 'pack.json' }, { name: 'preview.png' }],
    },
  ])

  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        ...response,
        _bIsWithheld: true,
        _sText: 'Restricted description',
        _aWithholdNotice: {
          _sType: 'softhold',
          _aRulesViolated: [{ _sCode: 'Rule 1' }],
        },
      }),
    ),
  )
  const withheld = await getOnlinePack(34)
  expect(withheld.withholdNotice).toMatchObject({
    type: 'softhold',
    rules: [{ code: 'Rule 1' }],
  })
  expect(withheld.descriptionHtml).toBeUndefined()
  expect(withheld.files).toEqual([])
  await expect(getOnlinePackDownload(34, 55)).rejects.toThrow(
    /no longer available/,
  )
  await expect(getOnlinePackArchiveContents(34, 55)).rejects.toThrow(
    /does not provide contents/,
  )
})

it('imports a verified ZIP into the library and reuses it on repeat downloads', async () => {
  const archive = zipSync({
    'dub_video.ogv': strToU8('video'),
    'line.wav': strToU8('audio'),
    'line.ini': strToU8('[data]\ndub_timestamps=[2]'),
  })
  const file = {
    id: 55,
    name: 'example.zip',
    packTitle: 'Example pack',
    size: archive.byteLength,
    checksum: createHash('md5').update(archive).digest('hex'),
  }
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.redirect('https://files.gamebanana.com/mods/example.zip'),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array(archive)))
  vi.stubGlobal('fetch', fetchMock)

  const directory = await mkdtemp(join(tmpdir(), 'gamebanana-import-'))
  const packStorage = join(directory, 'packs')
  const store = new LibraryStore(directory)
  const startingImport = vi.fn()
  try {
    const download = () =>
      importOnlinePackZip(
        file,
        directory,
        packStorage,
        store,
        vi.fn(),
        startingImport,
      )
    const pack = await download()
    expect(startingImport).toHaveBeenNthCalledWith(1)
    expect(startingImport).toHaveBeenLastCalledWith(100)
    expect(pack.metadata.title).toBe('Example pack')
    expect(pack.source).toEqual({
      kind: 'zip',
      location: 'https://gamebanana.com/dl/55',
    })
    expect(await readFile(join(packStorage, pack.id, pack.videoRef), 'utf8')).toBe(
      'video',
    )
    expect(await new LibraryStore(directory).listPacks()).toEqual([pack])
    expect(await download()).toEqual(pack)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(await readdir(packStorage)).toEqual([pack.id])
    expect(await readdir(directory)).not.toContainEqual(
      expect.stringMatching(/^gamebanana-/),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('only replaces the destination after the streamed file passes verification', async () => {
  const content = 'archive fixture'
  const file = {
    id: 55,
    name: 'example.zip',
    size: Buffer.byteLength(content),
    checksum: createHash('md5').update(content).digest('hex'),
  }
  const source = 'https://gamebanana.com/dl/55'
  const cdn = 'https://files.gamebanana.com/mods/example.zip'
  const cache = 'https://filecache40.gamebanana.com/mods/example.zip'
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.redirect('https://example.com/example.zip'))
    .mockResolvedValueOnce(Response.redirect(cdn))
    .mockResolvedValueOnce(new Response('invalid archive'))
    .mockResolvedValueOnce(Response.redirect(cdn))
    .mockResolvedValueOnce(Response.redirect(cache))
    .mockResolvedValueOnce(new Response(content))
  vi.stubGlobal('fetch', fetchMock)

  const directory = await mkdtemp(join(tmpdir(), 'gamebanana-test-'))
  const destination = join(directory, file.name)
  const progress = vi.fn()
  try {
    await writeFile(destination, 'previous contents')
    await expect(
      saveOnlinePackDownload(file, destination, progress),
    ).rejects.toThrow(/download is unavailable/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await expect(
      saveOnlinePackDownload(file, destination, progress),
    ).rejects.toThrow(/checksum/)
    expect(await readFile(destination, 'utf8')).toBe('previous contents')
    expect(await readdir(directory)).toEqual([file.name])

    await saveOnlinePackDownload(file, destination, progress)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      source,
      source,
      cdn,
      source,
      cdn,
      cache,
    ])
    expect(await readFile(destination, 'utf8')).toBe(content)
    expect(progress).toHaveBeenLastCalledWith(100)
    expect(await readdir(directory)).toEqual([file.name])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it.each([
  { size: 32 * 1024 * 1024, partSize: 5_592_406, partCount: 6 },
  { size: 48 * 1024 * 1024 + 3, partSize: 8 * 1024 * 1024, partCount: 7 },
])('downloads a $size-byte archive six ranges at a time', async ({ size, partSize, partCount }) => {
  const archive = Buffer.alloc(size)
  for (let start = 0; start < archive.length; start += partSize)
    archive.fill(start / partSize + 1, start, Math.min(start + partSize, archive.length))
  const file = {
    id: 55,
    name: 'large.zip',
    size: archive.length,
    checksum: createHash('md5').update(archive).digest('hex'),
  }
  const requested: number[] = []
  let releaseFirstPart!: () => void
  const firstPart = new Promise<void>((resolve) => { releaseFirstPart = resolve })
  let markBatchStarted!: () => void
  const batchStarted = new Promise<void>((resolve) => { markBatchStarted = resolve })
  vi.stubGlobal('fetch', vi.fn(async (url: URL, options: RequestInit) => {
    if (url.hostname === 'gamebanana.com')
      return Response.redirect('https://files.gamebanana.com/mods/large.zip')
    const [, startText, endText] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options.headers).get('Range')!)!
    const start = Number(startText)
    const end = Number(endText)
    requested.push(start)
    if (requested.length === 6) markBatchStarted()
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        if (start === 0) await firstPart
        controller.enqueue(archive.subarray(start, end + 1))
        controller.close()
      },
    })
    return new Response(body, {
      status: 206,
      headers: { 'Content-Range': `bytes ${start}-${end}/${archive.length}` },
    })
  }))
  const directory = await mkdtemp(join(tmpdir(), 'gamebanana-ranges-'))
  try {
    const destination = join(directory, file.name)
    const progress = vi.fn()
    const download = saveOnlinePackDownload(file, destination, progress, AbortSignal.timeout(4000))
    const expectedStarts = Array.from({ length: partCount }, (_, index) => index * partSize)
    try {
      await Promise.race([batchStarted, download])
      expect(requested).toEqual(expectedStarts.slice(0, 6))
    } finally {
      releaseFirstPart()
      await download
    }
    expect(requested).toEqual(expectedStarts)
    expect(createHash('md5').update(await readFile(destination)).digest('hex')).toBe(file.checksum)
    expect(progress).toHaveBeenLastCalledWith(100)
    expect(await readdir(directory)).toEqual([file.name])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('cancels a large download when the CDN streams a full response and preserves the destination', async () => {
  const controller = new AbortController()
  const cancelled = vi.fn()
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      stream.enqueue(new Uint8Array(1024))
    },
    cancel: cancelled,
  })
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.redirect('https://files.gamebanana.com/mods/large.zip'))
    .mockResolvedValueOnce(new Response(body))
  vi.stubGlobal('fetch', fetchMock)
  const directory = await mkdtemp(join(tmpdir(), 'gamebanana-cancel-'))
  const file = { id: 55, name: 'large.zip', size: 64 * 1024 * 1024, checksum: 'unused' }
  const destination = join(directory, file.name)
  try {
    await writeFile(destination, 'previous contents')
    await expect(
      saveOnlinePackDownload(file, destination, () => controller.abort(), controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(cancelled).toHaveBeenCalledOnce()
    expect(await readFile(destination, 'utf8')).toBe('previous contents')
    expect(await readdir(directory)).toEqual([file.name])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('cleans up the archive and extracted files if import is cancelled', async () => {
  const archive = zipSync({
    'dub_video.ogv': strToU8('video'),
    'line.wav': strToU8('audio'),
    'line.ini': strToU8('[data]\ndub_timestamps=[2]'),
  })
  const file = {
    id: 55,
    name: 'example.zip',
    packTitle: 'Example pack',
    size: archive.byteLength,
    checksum: createHash('md5').update(archive).digest('hex'),
  }
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.redirect('https://files.gamebanana.com/mods/example.zip'))
    .mockResolvedValueOnce(new Response(new Uint8Array(archive))))
  const directory = await mkdtemp(join(tmpdir(), 'gamebanana-cancel-import-'))
  const packStorage = join(directory, 'packs')
  const store = new LibraryStore(directory)
  const controller = new AbortController()
  try {
    const importing = (percent?: number) => {
      if (percent && percent < 100) controller.abort()
    }
    await expect(
      importOnlinePackZip(file, directory, packStorage, store, vi.fn(), importing, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(await store.listPacks()).toEqual([])
    expect(await readdir(packStorage)).toEqual([])
    expect(await readdir(directory)).not.toContainEqual(expect.stringMatching(/^gamebanana-/))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
