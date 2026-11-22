import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import {
  parseDubPack,
  type DesktopApi,
  type OnlinePackDownloadEntry,
  type OnlinePackDownloadsSnapshot,
} from '@studio/shared'
import { App } from '@/App'

afterEach(() => {
  cleanup()
  localStorage.removeItem('studio.online-pack-favourites')
})

it('retries the catalog, opens a listing and adds its selected ZIP to Local packs', async () => {
  const browseOnlinePacks = vi
    .fn<DesktopApi['browseOnlinePacks']>()
    .mockRejectedValueOnce(new Error('Offline'))
    .mockResolvedValueOnce({
      packs: [{ id: 12, title: 'First pack', hasContentNotice: false }],
      hasNextPage: true,
    })
    .mockResolvedValue({
      packs: [
        {
          id: 34,
          title: 'Second pack',
          hasContentNotice: false,
          categoryId: 48430,
        },
      ],
      hasNextPage: false,
    })
  const getOnlinePack = vi.fn(async () => ({
    id: 34,
    title: 'Second pack',
    images: [],
    hasContentNotice: false,
    categoryId: 48430,
    descriptionHtml:
      '<p>A &amp; B</p><p>First role<br>Second role</p><ul><li>Install instructions</li></ul><script>not listing content</script><a href="javascript:alert(0)">Unsafe link</a>' +
      '<p>More pack information. </p>'.repeat(33) +
      '<p>End of the description.</p>',
    files: [
      {
        id: 55,
        name: 'second.zip',
        size: 1024,
        canDownload: true,
        hasContents: true,
      },
      {
        id: 56,
        name: 'bonus.zip',
        size: 2048,
        canDownload: true,
      },
    ],
    ratings: [],
    tags: ['English'],
    credits: [
      { group: 'Authors', authors: [{ name: 'Pack creator', role: 'Editor' }] },
    ],
    studios: [],
    mirrors: [],
    licenseHtml: '<strong>Example license</strong>',
    permissions: [],
    counts: { comments: 1, updates: 1 },
  }))
  const getOnlinePackActivity = vi.fn<DesktopApi['getOnlinePackActivity']>(
    async (_packId, kind, _page, parent) => ({
      entries: [
        kind === 'updates'
          ? {
              id: 1,
              title: 'New release',
              changes: [{ category: 'Addition', text: 'New scene' }],
            }
          : parent
            ? { id: 3, bodyHtml: '<p>Thanks for playing.</p>', changes: [] }
            : {
                id: 2,
                bodyHtml: '<p>Great pack.</p>',
                replyCount: 1,
                changes: [],
              },
      ],
      hasNextPage: false,
    }),
  )
  const downloadedPack = parseDubPack({
    id: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    source: { kind: 'zip', location: 'https://gamebanana.com/dl/55' },
    folderName: 'Downloaded pack',
    files: [
      { path: 'dub_video.ogv' },
      { path: 'line.wav' },
      { path: 'line.ini', text: '[data]\ndub_timestamps=[2]' },
    ],
  })
  const downloadOnlinePack = vi
    .fn<DesktopApi['downloadOnlinePack']>()
    .mockResolvedValue({ kind: 'imported', pack: downloadedPack })
  const cancelOnlinePackDownload = vi.fn<DesktopApi['cancelOnlinePackDownload']>()
  let publishDownloads!: Parameters<DesktopApi['onOnlinePackDownloadsChanged']>[0]
  let publishImport!: Parameters<DesktopApi['onOnlinePackImported']>[0]
  let snapshot: OnlinePackDownloadsSnapshot = {
    revision: 0,
    downloads: [],
    completedBytes: 0,
  }
  const getOnlinePackDownloads = vi.fn(async () => snapshot)
  function updateDownloads(downloads: OnlinePackDownloadEntry[], completedBytes = 0) {
    snapshot = { revision: snapshot.revision + 1, downloads, completedBytes }
    publishDownloads(snapshot)
  }
  const getOnlinePackArchiveContents = vi.fn(async () => [
    { name: 'Pack', children: [{ name: 'pack.json' }] },
  ])
  window.studio = {
    browseOnlinePacks,
    listOnlinePackCategories: async () => [{ id: 48430, name: 'Memes' }],
    getOnlinePack,
    getOnlinePackActivity,
    downloadOnlinePack,
    cancelOnlinePackDownload,
    getOnlinePackArchiveContents,
    getOnlinePackDownloads,
    clearFinishedOnlinePackDownloads: async () => updateDownloads([]),
    onOnlinePackDownloadsChanged: (callback: typeof publishDownloads) => {
      publishDownloads = callback
      return () => undefined
    },
    onOnlinePackImported: (callback: typeof publishImport) => {
      publishImport = callback
      return () => undefined
    },
    getUpdateStatus: async () => ({ phase: 'idle' }),
    getAppVersion: async () => '1.1.2',
    onUpdateStatus: () => () => undefined,
    listPacks: async () => [],
    listProjects: async () => [],
  } as unknown as DesktopApi

  render(
    <MemoryRouter initialEntries={['/browse']}>
      <App />
    </MemoryRouter>,
  )

  expect(screen.getByRole('button', { name: 'Downloads' })).toBeVisible()
  expect(screen.queryByRole('region', { name: 'Download activity' })).toBeNull()
  expect(screen.getByRole('status', { name: 'Loading packs' })).toBeVisible()
  expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load')
  const navigation = screen.getByRole('navigation', {
    name: 'Studio navigation',
  })
  const browseLink = within(navigation).getByRole('link', {
    name: 'Browse packs',
  })
  expect(browseLink).toHaveAttribute('aria-current', 'page')
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('link', { name: 'First pack' })).toBeVisible()
  expect(browseOnlinePacks.mock.calls).toEqual([
    [1, undefined, undefined, undefined],
    [1, undefined, undefined, undefined],
  ])

  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
  const listing = await screen.findByRole('link', { name: 'Second pack' })
  expect(browseOnlinePacks).toHaveBeenLastCalledWith(
    2,
    undefined,
    undefined,
    undefined,
  )
  expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()

  fireEvent.click(listing)
  const readMore = await screen.findByRole('button', { name: 'Read more' })
  const description = within(
    screen.getByRole('region', { name: 'Pack description' }),
  )
  expect(description.getByText('A & B').tagName).toBe('P')
  const roles = description.getByText(/^First role\s*Second role$/)
  expect(roles.querySelector('br')).toBeInTheDocument()
  const instructions = description.getByRole('listitem')
  expect(instructions).toHaveTextContent('Install instructions')
  expect(screen.queryByText('End of the description.')).toBeNull()
  fireEvent.click(readMore)
  expect(roles.querySelector('br')).toBeInTheDocument()
  expect(description.getByRole('listitem')).toBe(instructions)
  expect(screen.getByText('End of the description.')).toBeVisible()
  expect(screen.getByRole('navigation', { name: 'Studio navigation' })).toBe(
    navigation,
  )
  expect(browseLink).toHaveAttribute('aria-current', 'page')
  expect(screen.queryByText('not listing content')).toBeNull()
  expect(screen.queryByRole('link', { name: 'Unsafe link' })).toBeNull()
  expect(
    screen.queryByRole('button', { name: 'View on GameBanana' }),
  ).toBeNull()
  expect(screen.getByText('Pack creator · Editor')).toBeVisible()
  expect(screen.getByText('Example license')).toBeVisible()
  expect(await screen.findByText('New scene')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Comments (1)' }))
  expect(await screen.findByText('Great pack.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Show replies (1)' }))
  expect(await screen.findByText('Thanks for playing.')).toBeVisible()
  expect(getOnlinePack).toHaveBeenCalledWith(34)
  fireEvent.click(screen.getByRole('button', { name: 'Read less' }))
  expect(screen.queryByText('End of the description.')).toBeNull()
  expect(description.getByRole('listitem')).toBe(instructions)
  fireEvent.click(
    screen.getByRole('button', { name: 'View file contents: second.zip' }),
  )
  const contents = screen.getByRole('dialog', { name: 'File contents' })
  expect(await within(contents).findByText('pack.json')).toBeVisible()
  expect(getOnlinePackArchiveContents).toHaveBeenCalledWith(34, 55)
  fireEvent.click(
    within(contents).getByRole('button', { name: 'Close file contents' }),
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Add to favourites: Second pack' }),
  )
  const second = {
    packId: 34,
    fileId: 55,
    name: 'second.zip',
    size: 1024,
  }
  downloadOnlinePack.mockImplementationOnce(async () => {
    updateDownloads([{ ...second, status: 'saved', phase: 'downloading' }], second.size)
    return { kind: 'saved', name: second.name }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save to device: second.zip' }))
  expect(downloadOnlinePack).toHaveBeenLastCalledWith(34, 55, 'device')
  expect(await screen.findByText('Saved to device.')).toBeVisible()

  type DownloadResult = Awaited<ReturnType<DesktopApi['downloadOnlinePack']>>
  let finishSecond!: (result: DownloadResult) => void
  let finishBonus!: (result: DownloadResult) => void
  downloadOnlinePack
    .mockReturnValueOnce(new Promise((resolve) => { finishSecond = resolve }))
    .mockReturnValueOnce(new Promise((resolve) => { finishBonus = resolve }))
  cancelOnlinePackDownload.mockImplementationOnce(async () => {
    finishBonus({ kind: 'cancelled' })
  })
  fireEvent.click(screen.getByRole('button', { name: 'Download to app: second.zip' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save to device: bonus.zip' }))
  expect(downloadOnlinePack).toHaveBeenLastCalledWith(34, 56, 'device')
  const popup = screen.getByRole('region', { name: 'Download activity' })
  const transferring = { ...second, status: 'working', phase: 'downloading', percent: 37 } as const
  const queued = {
    packId: 34,
    fileId: 56,
    name: 'bonus.zip',
    size: 2048,
    status: 'working',
    phase: 'queued',
  } as const
  snapshot = {
    revision: snapshot.revision + 1,
    downloads: [queued, transferring],
    completedBytes: 0,
  }
  fireEvent.click(within(popup).getByRole('button', { name: 'Refresh downloads' }))
  expect(
    await within(popup).findByRole('progressbar', { name: 'Downloading second.zip' }),
  ).toHaveAttribute('value', '37')
  expect(getOnlinePackDownloads).toHaveBeenCalledTimes(2)
  expect(downloadOnlinePack).toHaveBeenCalledTimes(3)
  expect(within(popup).getByText('Queued')).toBeVisible()
  const downloadsButton = screen.getByRole('button', { name: 'Downloads (2)' })
  fireEvent.click(downloadsButton)
  expect(popup).not.toBeInTheDocument()
  expect(downloadsButton).toHaveTextContent(/^2$/)
  expect(downloadsButton).toHaveAttribute('aria-description', '12% downloaded overall')
  fireEvent.click(downloadsButton)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel bonus.zip' }))
  expect(cancelOnlinePackDownload).toHaveBeenCalledWith(34, 56)
  act(() => updateDownloads([{ ...queued, status: 'cancelled' }, transferring]))
  expect(await screen.findByText('Download cancelled.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Downloads (1)' })).toHaveAttribute(
    'aria-description',
    '37% downloaded overall',
  )
  expect(screen.getByRole('button', { name: 'Cancel second.zip' })).toBeEnabled()
  expect(downloadOnlinePack).toHaveBeenCalledWith(34, 55, 'app')

  fireEvent.click(
    within(screen.getByRole('banner')).getByRole('link', {
      name: 'Browse packs',
    }),
  )
  expect(await screen.findByRole('link', { name: 'Second pack' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Cancel second.zip' })).toBeEnabled()
  await act(async () => {
    finishSecond({ kind: 'imported', pack: downloadedPack })
    updateDownloads([
      {
        ...second,
        status: 'imported',
        phase: 'importing',
        title: downloadedPack.metadata.title,
      },
      { ...queued, status: 'cancelled' },
    ], second.size)
    publishImport(downloadedPack)
  })
  expect(await screen.findByText('Added Downloaded pack to Local packs.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Downloads' })).toHaveAttribute(
    'aria-description',
    '100% downloaded overall',
  )
  expect(screen.getByText('Page 2')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Remove from favourites: Second pack' }),
  ).toHaveAttribute('aria-pressed', 'true')
  const searchBox = screen.getByRole('searchbox', { name: 'Search pack titles' })
  fireEvent.change(searchBox, { target: { value: '  second pack  ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByText('Page 1')).toBeVisible()
  expect(searchBox).toHaveValue('second pack')
  expect(browseOnlinePacks).toHaveBeenLastCalledWith(
    1,
    undefined,
    undefined,
    'second pack',
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'Order by' }), {
    target: { value: 'title-asc' },
  })
  expect(await screen.findByRole('link', { name: 'Second pack' })).toHaveAttribute(
    'href',
    '/browse/34?q=second+pack&order=title-asc',
  )
  expect(browseOnlinePacks).toHaveBeenLastCalledWith(
    1,
    undefined,
    'title-asc',
    'second pack',
  )
  fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), {
    target: { value: '48430' },
  })
  expect(await screen.findByRole('link', { name: 'Second pack' })).toBeVisible()
  expect(browseOnlinePacks).toHaveBeenLastCalledWith(
    1,
    48430,
    'title-asc',
    'second pack',
  )
  fireEvent.click(screen.getByRole('button', { name: 'Favourites' }))
  const onlineCalls = browseOnlinePacks.mock.calls.length
  expect(screen.getByRole('link', { name: 'Second pack' })).toBeVisible()
  fireEvent.change(searchBox, { target: { value: 'missing' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(screen.getByText('No favourites match your search.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(searchBox).toHaveValue('')
  expect(browseOnlinePacks).toHaveBeenCalledTimes(onlineCalls)
  const favouriteListing = screen.getByRole('link', { name: 'Second pack' })
  expect(favouriteListing).toBeVisible()

  const packsTab = within(navigation).getByRole('button', {
    name: 'Packs menu',
  })
  const recordingsTab = within(navigation).getByRole('button', {
    name: 'Recordings menu',
  })
  fireEvent.click(packsTab)
  const panel = within(
    screen.getByRole('complementary', { name: 'Studio sidebar' }),
  )
  expect(panel.getByRole('region', { name: 'Imported packs' })).toBeVisible()
  expect(panel.getByRole('button', { name: 'Open Downloaded pack' })).toBeVisible()
  expect(panel.getByRole('button', { name: 'Upload' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Second pack' })).toBe(
    favouriteListing,
  )

  fireEvent.click(recordingsTab)
  expect(await panel.findByRole('region', { name: 'Recordings' })).toBeVisible()
  expect(recordingsTab).toHaveAttribute('aria-expanded', 'true')
  expect(packsTab).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('link', { name: 'Second pack' })).toBe(
    favouriteListing,
  )
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue(
    '48430',
  )
  expect(browseLink).toHaveAttribute('aria-current', 'page')
  const settingsTab = within(navigation).getByRole('button', {
    name: 'Settings menu',
  })
  fireEvent.click(settingsTab)
  expect(
    await panel.findByRole('region', { name: 'Settings panel' }),
  ).toBeVisible()
  expect(await panel.findByText('1.1.2')).toBeVisible()
  expect(settingsTab).toHaveAttribute('aria-expanded', 'true')
  expect(recordingsTab).toHaveAttribute('aria-expanded', 'false')
  expect(screen.getByRole('link', { name: 'Second pack' })).toBe(
    favouriteListing,
  )
  expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue(
    '48430',
  )
  expect(browseLink).toHaveAttribute('aria-current', 'page')
  fireEvent.click(settingsTab)
  expect(
    screen.queryByRole('complementary', { name: 'Studio sidebar' }),
  ).toBeNull()

  expect(screen.queryByRole('button', { name: 'Local packs' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Clear finished' }))
  expect(screen.getByText('No downloads yet.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Downloads' }))
  fireEvent.click(within(navigation).getByRole('link', { name: 'Home' }))
  expect(
    await screen.findByRole('button', { name: 'UPLOAD DUB PACK' }),
  ).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Downloads' })).toBeNull()
  fireEvent.click(browseLink)
  const downloadTrigger = screen.getByRole('button', { name: 'Downloads' })
  expect(downloadTrigger).toBeVisible()
  expect(downloadTrigger).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(downloadTrigger)
  expect(screen.getByText('No downloads yet.')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Favourites' }))
  expect(screen.getByRole('link', { name: 'Second pack' })).toBeVisible()
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove from favourites: Second pack' }),
  )
  expect(screen.getByText('No favourite packs yet.')).toBeVisible()
})
