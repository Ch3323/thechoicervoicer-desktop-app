import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseDubPack,
  type DesktopApi,
  type DubbingProject,
  type RecordingTake,
  type RoomState,
  type UpdateStatus,
} from '@studio/shared'
import { HomePage } from './HomePage'

vi.mock('./WorkspacePage', () => ({
  WorkspacePage: ({ activeProjectId }: { activeProjectId: string }) => (
    <div data-testid="studio">{activeProjectId}</div>
  ),
}))

const pack = parseDubPack({
  id: 'pack-1',
  source: { kind: 'folder', location: 'C:/scene' },
  folderName: 'Scene',
  files: [
    { path: 'dub_video.ogv' },
    { path: 'line.wav' },
    {
      path: 'line.ini',
      text: '[data]\ndub_timestamps=[2]\ndub_characters=["A"]',
    },
  ],
})
const project: DubbingProject = {
  id: '00000000-0000-4000-8000-000000000001',
  packId: pack.id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  enabledCharacterIds: [pack.characters[0].id],
}
const take: RecordingTake = {
  id: '00000000-0000-4000-8000-000000000002',
  projectId: project.id,
  dialogueId: pack.dialogues[0].id,
  fileRef: '00000000-0000-4000-8000-000000000002.webm',
  mimeType: 'audio/webm',
  durationSeconds: 1,
  offsetSeconds: 0,
  createdAt: project.createdAt,
  selected: true,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function showHome() {
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  it('opens the Browse Packs page from the bottom of navigation', async () => {
    window.studio = {
      listPacks: async () => [pack],
      listProjects: async () => [project],
      getRoom: async () => null,
      onRoomState: () => () => undefined,
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/browse" element={<h1>Browse Dub Packs</h1>} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByTestId('studio')

    const navigation = within(
      screen.getByRole('navigation', { name: 'Studio navigation' }),
    )
    const browse = navigation.getByRole('link', { name: 'Browse packs' })
    expect(browse).toBe(
      navigation.getByRole('button', { name: 'Settings menu' })
        .nextElementSibling,
    )
    fireEvent.click(browse)
    expect(
      await screen.findByRole('heading', { name: 'Browse Dub Packs' }),
    ).toBeVisible()
  })

  it('opens Browse Dub Packs from the welcome screen', async () => {
    window.studio = {
      listPacks: async () => [],
      listProjects: async () => [],
    } as unknown as DesktopApi
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/browse" element={<h1>Browse Dub Packs</h1>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(
      await screen.findByRole('link', { name: 'BROWSE DUB PACKS' }),
    )
    expect(
      screen.getByRole('heading', { name: 'Browse Dub Packs' }),
    ).toBeVisible()
  })

  it('opens multiplayer setup over the current page without changing the route', async () => {
    window.studio = {
      listPacks: async () => [pack],
      listProjects: async () => [project],
      getRoom: async () => null,
      onRoomState: () => () => undefined,
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    function CurrentPath() {
      return <span data-testid="current-path">{useLocation().pathname}</span>
    }
    render(
      <MemoryRouter initialEntries={['/']}>
        <HomePage />
        <CurrentPath />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'MULTIPLAYER' }))
    expect(
      await screen.findByRole('dialog', { name: 'Multiplayer mode' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('current-path')).toHaveTextContent('/')
    expect(screen.getByTestId('studio')).toHaveTextContent(project.id)
  })

  it('keeps the local studio visible behind room details until the game starts', async () => {
    const state: RoomState = {
      code: 'ABC234',
      hostPlayerId: 'host',
      players: [
        { id: 'host', displayName: 'Host', connected: true, isHost: true },
      ],
      assignments: {},
      dialogueOwners: {},
      pack: null,
      project: null,
      takes: [],
      exportProgress: null,
      exportComplete: false,
      readyPlayerIds: [],
      started: false,
    }
    window.studio = {
      listPacks: async () => [pack],
      listProjects: async () => [project],
      getRoom: async () => ({
        state,
        playerId: 'host',
        address: '127.0.0.1:4318',
      }),
      onRoomState: () => () => undefined,
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()

    expect(
      await screen.findByRole('button', { name: /IN ROOM/ }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('studio')).toHaveTextContent(project.id)
    fireEvent.click(screen.getByRole('button', { name: /IN ROOM/ }))
    expect(
      await screen.findByRole('dialog', { name: 'Room lobby' }),
    ).toBeInTheDocument()
    expect(screen.getByTestId('studio')).toHaveTextContent(project.id)
  })

  it('confirms before the host leaves and closes the room', async () => {
    const roomClose = vi.fn(async () => undefined)
    const state: RoomState = {
      code: 'ABC234',
      hostPlayerId: 'host',
      players: [
        { id: 'host', displayName: 'Host', connected: true, isHost: true },
      ],
      assignments: {},
      dialogueOwners: {},
      pack: null,
      project: null,
      takes: [],
      exportProgress: null,
      exportComplete: false,
      readyPlayerIds: [],
      started: false,
    }
    window.studio = {
      listPacks: async () => [],
      listProjects: async () => [],
      getRoom: async () => ({
        state,
        playerId: 'host',
        address: '127.0.0.1:4318',
      }),
      onRoomState: () => () => undefined,
      roomClose,
    } as unknown as DesktopApi
    showHome()

    fireEvent.click(await screen.findByRole('button', { name: 'LEAVE ROOM' }))
    const dialog = screen.getByRole('dialog', { name: 'Leave and close room?' })
    expect(roomClose).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave room' }))
    await waitFor(() => expect(roomClose).toHaveBeenCalledOnce())
  })

  it('leaves a multiplayer room before opening the selected pack in singleplayer', async () => {
    const otherPack = {
      ...pack,
      id: 'pack-2',
      metadata: { ...pack.metadata, title: 'Another Scene' },
    }
    const otherProject = { ...project, id: 'project-2', packId: otherPack.id }
    const roomLeave = vi.fn(async () => undefined)
    const state: RoomState = {
      code: 'ABC234',
      hostPlayerId: 'host',
      players: [
        { id: 'host', displayName: 'Host', connected: true, isHost: true },
        { id: 'guest', displayName: 'Guest', connected: true, isHost: false },
      ],
      assignments: {},
      dialogueOwners: {},
      pack: null,
      project: null,
      takes: [],
      exportProgress: null,
      exportComplete: false,
      readyPlayerIds: [],
      started: true,
    }
    window.studio = {
      listPacks: async () => [pack, otherPack],
      listProjects: async () => [project, otherProject],
      getRoom: async () => ({
        state,
        playerId: 'guest',
        address: '127.0.0.1:4318',
      }),
      onRoomState: () => () => undefined,
      roomLeave,
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Load Another Scene from hotbar',
      }),
    )
    const dialog = screen.getByRole('dialog', { name: 'Leave room?' })
    expect(dialog).toHaveTextContent('Another Scene')
    expect(roomLeave).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(roomLeave).not.toHaveBeenCalled()

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Load Another Scene from hotbar',
      }),
    )
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Leave room?' })).getByRole(
        'button',
        { name: 'Leave room' },
      ),
    )
    await waitFor(() => expect(roomLeave).toHaveBeenCalledOnce())
    expect(await screen.findByTestId('studio')).toHaveTextContent(
      otherProject.id,
    )
  })

  it('opens separate pack and recording tabs while keeping the hotbar visible', async () => {
    window.studio = {
      listPacks: async () => [pack],
      listProjects: async () => [project],
      listTakes: async () => [],
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()
    expect(
      screen.queryByRole('complementary', { name: 'Studio sidebar' }),
    ).toBeNull()
    expect(
      screen.getByRole('region', { name: 'Pack hotbar' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Packs menu' }))
    expect(
      await screen.findByRole('region', { name: 'Imported packs' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Recordings' })).toBeNull()
    expect(
      screen.getByRole('complementary', { name: 'Studio sidebar' }),
    ).toContainElement(screen.getByRole('region', { name: 'Imported packs' }))
    expect(screen.getByTestId('studio')).toHaveTextContent(project.id)
    expect(
      screen.getByRole('button', { name: 'Settings menu' }),
    ).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter packs' }), {
      target: { value: 'missing' },
    })
    expect(screen.getByText('No matching packs.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recordings menu' }))
    expect(
      screen.getByRole('region', { name: 'Recordings' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Imported packs' })).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Filter packs' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Recordings menu' }))
    expect(
      screen.queryByRole('complementary', { name: 'Studio sidebar' }),
    ).toBeNull()
  })

  it('shows settings in the sidebar without replacing the main content', async () => {
    const checkForUpdates = vi.fn(async () => undefined)
    const downloadUpdate = vi.fn(async () => undefined)
    const installUpdate = vi.fn(async () => undefined)
    let onUpdateStatus: (status: UpdateStatus) => void = () => undefined
    window.studio = {
      listPacks: async () => [],
      listProjects: async () => [],
      getAppVersion: async () => '1.2.3',
      getDriveStatus: async () => ({ connected: false }),
      getUpdateStatus: async () => ({ phase: 'available', version: '1.2.4' }),
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => {
        onUpdateStatus = callback
        return () => undefined
      },
      checkForUpdates,
      downloadUpdate,
      installUpdate,
    } as unknown as DesktopApi
    showHome()
    fireEvent.click(screen.getByRole('button', { name: 'Settings menu' }))
    expect(
      await screen.findByRole('region', { name: 'Settings panel' }),
    ).not.toHaveTextContent('1.2.3')
    expect(await screen.findByText('1.2.3')).toBeInTheDocument()
    expect(screen.getByLabelText('App version')).toHaveTextContent('1.2.3')
    expect(
      screen.getByRole('complementary', { name: 'Studio sidebar' }),
    ).toContainElement(screen.getByRole('region', { name: 'Settings panel' }))
    expect(screen.queryByText('Google Drive exports')).toBeNull()
    expect(screen.getByText('YOUR SCENE STARTS HERE')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Imported packs' })).toBeNull()
    expect(screen.getByText('Update available')).toBeInTheDocument()
    expect(
      screen.getByText(/Version 1\.2\.4 is ready to download/),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }))
    expect(checkForUpdates).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(downloadUpdate).toHaveBeenCalledOnce()
    act(() => onUpdateStatus({ phase: 'downloaded', version: '1.2.4' }))
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(installUpdate).toHaveBeenCalledOnce()
  })

  it('shows recording artwork and progress from selected takes', async () => {
    window.studio = {
      listPacks: async () => [pack],
      listProjects: async () => [project],
      listTakes: async () => [take],
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()
    fireEvent.click(screen.getByRole('button', { name: 'Recordings menu' }))
    expect(await screen.findByText('1 / 1 lines recorded')).toBeInTheDocument()
    const row = screen.getByRole('button', {
      name: `Open recording ${pack.metadata.title}`,
    })
    expect(row.querySelector('.home-recording-art')).toBeInTheDocument()
    expect(
      screen.getByRole('progressbar', {
        name: `Recording progress for ${pack.metadata.title}`,
      }),
    ).toHaveAttribute('aria-valuenow', '1')
  })

  it('keeps an empty draft out of recording history', async () => {
    window.studio = {
      listPacks: async () => [pack],
      listProjects: async () => [project],
      listTakes: async () => [],
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()
    fireEvent.click(screen.getByRole('button', { name: 'Recordings menu' }))
    expect(
      await screen.findByText(
        'No recordings yet. Record a track to add one here.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', {
        name: `Open recording ${pack.metadata.title}`,
      }),
    ).toBeNull()
    expect(screen.getByText('0 PROJECTS')).toBeInTheDocument()
  })

  it('offers continue, new recording, and delete on a hotbar pack', async () => {
    const newerDraft = {
      ...project,
      id: '00000000-0000-4000-8000-000000000003',
      updatedAt: '2026-01-02T00:00:00.000Z',
    }
    const newProject = {
      ...project,
      id: '00000000-0000-4000-8000-000000000004',
    }
    const createProject = vi.fn(async () => newProject)
    window.studio = {
      listPacks: async () => [pack],
      listProjects: async () => [project, newerDraft],
      listTakes: async (id: string) => (id === project.id ? [take] : []),
      createProject,
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()
    const tape = await screen.findByRole('button', {
      name: `Load ${pack.metadata.title} from hotbar`,
    })
    fireEvent.contextMenu(tape, { clientX: 20, clientY: 20 })
    const menu = screen.getByRole('menu', {
      name: `${pack.metadata.title} options`,
    })
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(3)
    fireEvent.click(
      within(menu).getByRole('menuitem', { name: 'Continue recording' }),
    )
    await waitFor(() =>
      expect(screen.getByTestId('studio')).toHaveTextContent(project.id),
    )
    expect(createProject).not.toHaveBeenCalled()
    fireEvent.contextMenu(tape, { clientX: 20, clientY: 20 })
    fireEvent.click(
      screen.getByRole('menuitem', { name: 'Create new recording' }),
    )
    await waitFor(() => expect(createProject).toHaveBeenCalledWith(pack.id))
    expect(screen.getByTestId('studio')).toHaveTextContent(newProject.id)
    fireEvent.contextMenu(tape, { clientX: 20, clientY: 20 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete pack' }))
    expect(
      screen.getByRole('dialog', { name: 'Remove Dub Pack?' }),
    ).toBeInTheDocument()
  })

  it('offers the same pack menu on a sidebar card', async () => {
    window.studio = {
      listPacks: async () => [pack],
      listProjects: async () => [project],
      listTakes: async () => [take],
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()
    fireEvent.click(screen.getByRole('button', { name: 'Packs menu' }))
    const card = (
      await screen.findByRole('button', {
        name: `Open ${pack.metadata.title}`,
      })
    ).closest('.home-pack-card')
    expect(card).not.toBeNull()
    fireEvent.contextMenu(card!, { clientX: 20, clientY: 20 })
    const menu = screen.getByRole('menu', {
      name: `${pack.metadata.title} options`,
    })
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Continue recording', 'Create new recording', 'Delete pack'])
  })

  it('opens an existing project in place', async () => {
    const createProject = vi.fn()
    window.studio = {
      listPacks: async () => [pack],
      listProjects: async () => [project],
      createProject,
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()
    fireEvent.click(screen.getByRole('button', { name: 'Packs menu' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: `Open ${pack.metadata.title}`,
      }),
    )
    expect(screen.getByTestId('studio')).toHaveTextContent(project.id)
    expect(createProject).not.toHaveBeenCalled()
  })

  it('creates a project for an unused pack without navigating', async () => {
    const createProject = vi.fn(async () => project)
    window.studio = {
      listPacks: async () => [pack],
      listProjects: async () => [],
      createProject,
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()
    fireEvent.click(screen.getByRole('button', { name: 'Packs menu' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: `Open ${pack.metadata.title}`,
      }),
    )
    await waitFor(() => expect(createProject).toHaveBeenCalledWith(pack.id))
    expect(await screen.findByTestId('studio')).toHaveTextContent(project.id)
  })

  it('opens an imported pack while its video preview prepares', async () => {
    let imported = false
    const previewReady = new Promise<string>(() => undefined)
    const getPreviewUrl = vi.fn(() => previewReady)
    const createProject = vi.fn(async () => project)
    window.studio = {
      listPacks: async () => (imported ? [pack] : []),
      listProjects: async () => [],
      importPack: async () => {
        imported = true
        return pack
      },
      onImportProgress: () => () => {},
      getPreviewUrl,
      createProject,
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'UPLOAD DUB PACK' }),
      ).not.toBeDisabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'UPLOAD DUB PACK' }))
    await waitFor(() => expect(getPreviewUrl).toHaveBeenCalledWith(pack.id))
    expect(await screen.findByTestId('studio')).toHaveTextContent(project.id)
    expect(createProject).toHaveBeenCalledWith(pack.id)
  })

  it('requires an in-app confirmation before deleting a recording', async () => {
    const deleteProject = vi.fn(async () => undefined)
    window.studio = {
      listPacks: async () => [pack],
      listProjects: async () => [project],
      listTakes: async () => [take],
      deleteProject,
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()
    fireEvent.click(screen.getByRole('button', { name: 'Recordings menu' }))
    fireEvent.click(
      await screen.findByRole('button', {
        name: `Delete recording ${pack.metadata.title}`,
      }),
    )
    expect(
      screen.getByRole('dialog', { name: 'Delete recording?' }),
    ).toBeInTheDocument()
    expect(deleteProject).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(deleteProject).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole('button', {
        name: `Delete recording ${pack.metadata.title}`,
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: /^Delete recording$/ }))
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith(project.id))
  })

  it('confirms deleting a pack with its recording project', async () => {
    let removed = false
    const removePack = vi.fn(async () => {
      removed = true
    })
    window.studio = {
      listPacks: async () => (removed ? [] : [pack]),
      listProjects: async () => (removed ? [] : [project]),
      removePack,
      getAssetUrl: async () => 'studio-media://pack/cover.png',
    } as unknown as DesktopApi
    showHome()
    fireEvent.click(screen.getByRole('button', { name: 'Packs menu' }))
    const removeButton = await screen.findByRole('button', {
      name: `Remove ${pack.metadata.title}`,
    })
    expect(removeButton).toBeEnabled()
    fireEvent.click(removeButton)
    expect(
      screen.getByRole('dialog', { name: 'Remove Dub Pack?' }),
    ).toHaveTextContent('1 recording project and all takes')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(removePack).not.toHaveBeenCalled()
    fireEvent.click(removeButton)
    fireEvent.click(screen.getByRole('button', { name: 'Remove pack' }))
    await waitFor(() => expect(removePack).toHaveBeenCalledWith(pack.id))
  })
})
