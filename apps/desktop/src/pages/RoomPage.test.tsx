import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseDubPack,
  type DesktopApi,
  type DubbingProject,
  type RecordingTake,
  type RoomState,
} from '@studio/shared'
import { RoomPage } from './RoomPage'

const pack = parseDubPack({
  id: 'pack-1',
  source: { kind: 'folder', location: 'C:/scene' },
  folderName: 'Scene',
  files: [
    { path: 'dub_video.ogv' },
    { path: 'line.wav' },
    { path: 'line.png' },
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
  enabledCharacterIds: [],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('RoomPage setup', () => {
  it('shows a taken name as soon as a player clicks a room', async () => {
    const getRoomJoinInfo = vi.fn(async () => {
      throw new Error('Name already taken')
    })
    const joinRoom = vi.fn()
    window.studio = {
      getRoom: async () => null,
      onRoomState: () => () => undefined,
      listPacks: async () => [],
      discoverRooms: async () => [
        {
          address: '127.0.0.1:4318',
          code: 'ABC234',
          title: 'Scene',
          players: 1,
        },
      ],
      getRoomJoinInfo,
      joinRoom,
    } as unknown as DesktopApi
    render(
      <MemoryRouter>
        <RoomPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'JOIN ROOM' }))
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
      target: { value: 'Host' },
    })
    fireEvent.click(
      await screen.findByRole('button', {
        name: /Scene.*127\.0\.0\.1:4318.*JOIN/,
      }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Name already taken',
    )
    expect(getRoomJoinInfo).toHaveBeenCalledWith(
      '127.0.0.1:4318',
      'ABC234',
      'Host',
    )
    expect(
      screen.queryByRole('dialog', { name: 'Choose available roles' }),
    ).toBeNull()
    expect(joinRoom).not.toHaveBeenCalled()
  })

  it('requires a Host pack download before choosing roles and joining', async () => {
    let localPacks: (typeof pack)[] = []
    const state: RoomState = {
      code: 'ABC234',
      hostPlayerId: 'host',
      players: [
        { id: 'host', displayName: 'Host', connected: true, isHost: true },
        {
          id: 'guest',
          displayName: 'Guest',
          connected: true,
          isHost: false,
          packReady: true,
        },
      ],
      assignments: { [pack.characters[0].id]: 'guest' },
      dialogueOwners: {},
      pack,
      project: { ...project, enabledCharacterIds: [pack.characters[0].id] },
      takes: [],
      exportProgress: null,
      exportComplete: false,
      readyPlayerIds: [],
      started: false,
    }
    const joinRoom = vi.fn(async () => ({
      state,
      playerId: 'guest',
      address: '127.0.0.1:4318',
    }))
    window.studio = {
      getRoom: async () => null,
      onRoomState: () => () => undefined,
      discoverRooms: async () => [
        {
          address: '127.0.0.1:4318',
          code: 'ABC234',
          title: 'Scene',
          players: 1,
        },
      ],
      listProjects: async () => [],
      listPacks: async () => localPacks,
      getAssetUrl: async (_packId: string, ref: string) =>
        `studio-media://pack/${ref}`,
      getRoomJoinInfo: async () => ({
        code: 'ABC234',
        fingerprint: 'a'.repeat(64),
        title: 'Scene',
        started: false,
        matchingPacks: localPacks.map((item) => ({
          id: item.id,
          title: item.metadata.title,
        })),
        roles: [
          {
            id: pack.characters[0].id,
            name: pack.characters[0].name,
            clips: 1,
            available: true,
          },
        ],
      }),
      joinRoom,
      roomGetPreviewUrl: async () => 'studio-media://room/preview',
      roomGetAssetUrl: async () => 'studio-media://room/asset/line.png',
      prepareRoomPack: async () => {
        localPacks = [pack]
        return pack
      },
    } as unknown as DesktopApi
    render(
      <MemoryRouter>
        <RoomPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'JOIN ROOM' }))
    expect(screen.queryByLabelText('Local Dub Pack')).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'DOWNLOAD FROM HOST' }),
    ).toBeNull()
    const roomButton = await screen.findByRole('button', {
      name: /Scene.*127\.0\.0\.1:4318.*JOIN/,
    })
    expect(roomButton).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
      target: { value: 'Taylor' },
    })
    expect(roomButton).toBeEnabled()
    fireEvent.click(roomButton)
    const roles = await screen.findByRole('dialog', {
      name: 'Choose available roles',
    })
    expect(joinRoom).not.toHaveBeenCalled()
    expect(
      within(roles).getByRole('heading', { name: 'CHOOSE YOUR PACK' }),
    ).toBeVisible()
    expect(
      within(roles).queryByText('YOUR ROLES · SELECT ONE OR MORE'),
    ).toBeNull()
    expect(within(roles).queryByRole('checkbox', { name: /A/ })).toBeNull()
    expect(
      within(roles).queryByRole('button', { name: 'JOIN ROOM' }),
    ).toBeNull()
    const downloadButton = within(roles).getByRole('button', {
      name: 'Download pack from Host',
    })
    expect(downloadButton.closest('.multiplayer-lobby-pack')).not.toBeNull()
    fireEvent.click(downloadButton)
    await waitFor(() =>
      expect(within(roles).getByRole('checkbox', { name: /A/ })).toBeEnabled(),
    )
    await waitFor(() =>
      expect(
        roles.querySelector('.multiplayer-role-avatar img'),
      ).toHaveAttribute('src', 'studio-media://pack/line.png'),
    )
    expect(
      within(roles).getByRole('heading', { name: 'CHOOSE YOUR ROLES' }),
    ).toBeVisible()
    fireEvent.click(within(roles).getByRole('checkbox', { name: /A/ }))
    expect(within(roles).queryByText('SELECTED · JOIN TO CLAIM')).toBeNull()
    expect(
      roles.querySelector('.multiplayer-role-option.selected'),
    ).toHaveTextContent('1 CLIPS')
    fireEvent.click(within(roles).getByRole('button', { name: 'JOIN ROOM' }))
    await waitFor(() =>
      expect(joinRoom).toHaveBeenCalledWith(
        '127.0.0.1:4318',
        'ABC234',
        'Taylor',
        pack.id,
        [pack.characters[0].id],
      ),
    )
    const lobby = await screen.findByRole('dialog', { name: 'Room lobby' })
    expect(
      within(lobby).queryByRole('button', { name: 'Download pack from Host' }),
    ).toBeNull()
    expect(
      within(lobby).getByRole('button', { name: 'READY TO PLAY' }),
    ).toBeEnabled()
  })

  it.each([
    {
      kind: 'code',
      input: 'ABC234',
      address: '127.0.0.1:4318',
      code: 'ABC234',
    },
    { kind: 'IP address', input: '127.0.0.1', address: '127.0.0.1', code: '' },
  ])('joins manually by $kind alone', async ({ kind, input, address }) => {
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
    const joinRoom = vi.fn(async () => ({
      state,
      playerId: 'guest',
      address,
    }))
    window.studio = {
      getRoom: async () => null,
      onRoomState: () => () => undefined,
      discoverRooms: async () => [
        {
          address: '127.0.0.1:4318',
          code: 'ABC234',
          title: 'Scene',
          players: 1,
        },
      ],
      listProjects: async () => [],
      listPacks: async () => [pack],
      getAssetUrl: async (_packId: string, ref: string) =>
        `studio-media://pack/${ref}`,
      getRoomJoinInfo: async () => ({
        code: 'ABC234',
        fingerprint: 'a'.repeat(64),
        title: 'Scene',
        started: false,
        matchingPacks: [{ id: pack.id, title: pack.metadata.title }],
        roles: [
          {
            id: pack.characters[0].id,
            name: pack.characters[0].name,
            clips: 1,
            available: true,
          },
        ],
      }),
      joinRoom,
    } as unknown as DesktopApi
    render(
      <MemoryRouter>
        <RoomPage />
      </MemoryRouter>,
    )
    fireEvent.click(screen.getByRole('tab', { name: 'JOIN ROOM' }))
    const joinButton = screen.getByRole('button', { name: 'JOIN ROOM' })
    expect(joinButton).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
      target: { value: '   ' },
    })
    expect(joinButton).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
      target: { value: 'Guest' },
    })
    fireEvent.change(
      screen.getByPlaceholderText(
        kind === 'code' ? 'ABC234' : '192.168.1.5 or 192.168.1.5:4318',
      ),
      {
        target: { value: input },
      },
    )
    expect(joinButton).toBeEnabled()
    fireEvent.click(joinButton)
    const roles = await screen.findByRole('dialog', {
      name: 'Choose available roles',
    })
    expect(joinRoom).not.toHaveBeenCalled()
    expect(within(roles).queryByRole('checkbox', { name: /A/ })).toBeNull()
    fireEvent.change(
      within(roles).getByRole('combobox', { name: 'Matching Dub Pack' }),
      {
        target: { value: pack.id },
      },
    )
    fireEvent.click(within(roles).getByRole('checkbox', { name: /A/ }))
    fireEvent.click(within(roles).getByRole('button', { name: 'JOIN ROOM' }))
    await waitFor(() =>
      expect(joinRoom).toHaveBeenCalledWith(
        address,
        'ABC234',
        'Guest',
        pack.id,
        [pack.characters[0].id],
      ),
    )
  })

  it('shows an import state when no pack is available, then selects the imported pack', async () => {
    let packs: (typeof pack)[] = []
    const createProject = vi.fn()
    window.studio = {
      getRoom: async () => null,
      onRoomState: () => () => undefined,
      listPacks: async () => packs,
      importPack: async () => {
        packs = [pack]
        return pack
      },
      createProject,
      getAssetUrl: async (_packId: string, ref: string) =>
        `studio-media://pack/${ref}`,
    } as unknown as DesktopApi
    const { container } = render(
      <MemoryRouter>
        <RoomPage />
      </MemoryRouter>,
    )
    const selector = screen.getByRole('combobox', { name: 'Voice pack' })
    await waitFor(() =>
      expect(selector).toHaveDisplayValue('No Dub Packs imported'),
    )
    expect(selector).toBeDisabled()
    expect(container.querySelector('.multiplayer-pack-art')).toBeNull()
    expect(screen.getByRole('button', { name: 'CREATE ROOM' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'IMPORT ZIP' }))
    await waitFor(() => expect(selector).toHaveValue(pack.id))
    expect(selector).toBeEnabled()
    expect(createProject).not.toHaveBeenCalled()
  })

  it('creates a room from a pack without an existing recording project', async () => {
    const steps: string[] = []
    const copyRoomDetails = vi.fn(async () => undefined)
    let onRoomState: ((state: RoomState | null) => void) | undefined
    const state: RoomState = {
      code: 'ABC234',
      hostPlayerId: 'host',
      players: [
        { id: 'host', displayName: 'Tapitti', connected: true, isHost: true },
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
    const room = { state, playerId: 'host', address: '192.168.1.5:4318' }
    window.studio = {
      getRoom: async () => (steps.length ? room : null),
      onRoomState: (callback: (state: RoomState | null) => void) => {
        onRoomState = callback
        return () => undefined
      },
      listProjects: async () => [],
      listPacks: async () => [pack],
      createRoom: async () => {
        steps.push('create')
        return room
      },
      copyRoomDetails,
      roomSetPack: async (packId: string) => {
        expect(packId).toBe(pack.id)
        steps.push('pack')
        state.pack = pack
        state.project = project
      },
      roomClaimRole: async (id: string) => {
        steps.push('role')
        state.assignments[id] = 'host'
      },
      roomSetReady: async (value: boolean) => {
        state.readyPlayerIds = value ? ['host'] : []
        onRoomState?.({ ...state })
      },
      roomClose: async () => {
        steps.push('close')
      },
      roomGetPreviewUrl: async () => 'studio-media://room/preview',
      getAssetUrl: async (_packId: string, ref: string) =>
        `studio-media://pack/${ref}`,
      roomGetAssetUrl: async (ref: string) =>
        `studio-media://room/asset/${ref}`,
    } as unknown as DesktopApi

    const { container } = render(
      <MemoryRouter>
        <RoomPage />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('dialog', { name: 'Multiplayer mode' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'JOIN ROOM' }))
    expect(screen.getByPlaceholderText('ABC234')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'CREATE ROOM' }))
    fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
      target: { value: 'Tapitti' },
    })
    await waitFor(() =>
      expect(
        container.querySelector('.multiplayer-role-avatar img'),
      ).toHaveAttribute('src', 'studio-media://pack/line.png'),
    )
    fireEvent.click(await screen.findByRole('checkbox'))
    expect(screen.queryByText('SELECTED · CREATE TO CLAIM')).toBeNull()
    expect(
      container.querySelector('.multiplayer-role-option.selected'),
    ).toHaveTextContent('1 CLIPS')
    fireEvent.click(screen.getByRole('button', { name: 'CREATE ROOM' }))

    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: 'Room lobby' }),
      ).toBeInTheDocument(),
    )
    expect(steps).toEqual(['create', 'pack', 'role'])
    expect(
      screen.getByRole('dialog', { name: 'Room lobby' }),
    ).toHaveTextContent('ABC234')
    fireEvent.click(screen.getByRole('button', { name: 'COPY CODE' }))
    await waitFor(() => expect(copyRoomDetails).toHaveBeenCalledWith('code'))
    expect(screen.getByRole('button', { name: 'COPIED' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'COPY INVITE DETAILS' }))
    await waitFor(() => expect(copyRoomDetails).toHaveBeenCalledWith('invite'))
    expect(screen.getByRole('button', { name: 'READY TO PLAY' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'READY TO PLAY' }))
    expect(
      await screen.findByRole('button', { name: 'CANCEL READY' }),
    ).toHaveClass('multiplayer-cancel-ready')
    fireEvent.click(screen.getByRole('button', { name: 'CANCEL READY' }))
    expect(screen.queryByRole('button', { name: /Release A/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Claim A/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Share project' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Import ZIP' })).toBeNull()
    await waitFor(() =>
      expect(
        container.querySelector('.multiplayer-role-avatar img'),
      ).toHaveAttribute('src', 'studio-media://room/asset/line.png'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close room details' }))
    expect(screen.queryByRole('dialog', { name: 'Room lobby' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /IN ROOM/ }))
    expect(
      screen.getByRole('dialog', { name: 'Room lobby' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /choose roles/i }))
    const roleDialog = screen.getByRole('dialog', { name: 'Choose roles' })
    expect(roleDialog).toHaveTextContent('YOUR ROLES · SELECT ONE OR MORE')
    expect(
      within(roleDialog).getByRole('checkbox', { name: /A/ }),
    ).toBeChecked()
    await waitFor(() =>
      expect(
        roleDialog.querySelector('.multiplayer-role-avatar img'),
      ).toHaveAttribute('src', 'studio-media://room/asset/line.png'),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close role picker' }))
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Room lobby' })).getByRole(
        'button',
        { name: 'LEAVE ROOM' },
      ),
    )
    await waitFor(() => expect(steps.at(-1)).toBe('close'))
  })
})

it('updates role recording progress in the room modal during play', async () => {
  const roleId = pack.characters[0].id
  const dialogueId = pack.dialogues[0].id
  const state: RoomState = {
    code: 'ABC234',
    hostPlayerId: 'host',
    players: [
      { id: 'host', displayName: 'Host', connected: true, isHost: true },
    ],
    assignments: { [roleId]: 'host' },
    dialogueOwners: {},
    pack,
    project,
    takes: [],
    exportProgress: null,
    exportComplete: false,
    readyPlayerIds: ['host'],
    started: true,
  }
  let onRoomState: ((state: RoomState | null) => void) | undefined
  window.studio = {
    getRoom: async () => ({
      state,
      playerId: 'host',
      address: '127.0.0.1:4318',
    }),
    onRoomState: (callback: (state: RoomState | null) => void) => {
      onRoomState = callback
      return () => undefined
    },
    listPacks: async () => [pack],
    roomGetPreviewUrl: async () => 'studio-media://room/preview',
    roomGetAssetUrl: async (ref: string) => `studio-media://room/asset/${ref}`,
    roomGetWaveform: async () => null,
  } as unknown as DesktopApi

  render(
    <MemoryRouter>
      <RoomPage />
    </MemoryRouter>,
  )
  fireEvent.click(await screen.findByRole('button', { name: /IN ROOM/ }))
  const lobby = screen.getByRole('dialog', { name: 'Room lobby' })
  const incomplete = within(lobby).getByLabelText(
    `${pack.characters[0].name}: 0 of 1 lines recorded`,
  )
  expect(incomplete).toHaveTextContent('0/1')
  expect(incomplete).not.toHaveClass('complete')
  expect(within(lobby).queryByRole('progressbar')).not.toBeInTheDocument()

  const take: RecordingTake = {
    id: '00000000-0000-4000-8000-000000000011',
    projectId: project.id,
    dialogueId,
    fileRef: 'take.wav',
    mimeType: 'audio/wav',
    durationSeconds: 1,
    offsetSeconds: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    selected: true,
  }
  act(() => onRoomState?.({ ...state, takes: [take] }))
  const complete = within(lobby).getByLabelText(
    `${pack.characters[0].name}: 1 of 1 lines recorded`,
  )
  expect(complete).toHaveTextContent('1/1')
  expect(complete).toHaveClass('complete')
})

it('opens a joined session on the player’s first assigned line', async () => {
  const assignedCharacterId = pack.characters[0].id
  const roomPack = {
    ...pack,
    characters: [
      ...pack.characters,
      { ...pack.characters[0], id: 'other-character', name: 'Other' },
    ],
    dialogues: [
      {
        ...pack.dialogues[0],
        id: 'other-line',
        caption: 'Another character speaks first',
        characterIds: ['other-character'],
        timestampSeconds: 2,
      },
      {
        ...pack.dialogues[0],
        id: 'my-first-line',
        caption: 'My first line',
        timestampSeconds: 8,
      },
      {
        ...pack.dialogues[0],
        id: 'my-second-line',
        caption: 'My second line',
        timestampSeconds: 12,
      },
    ],
  }
  const state: RoomState = {
    code: 'ABC234',
    hostPlayerId: 'host',
    players: [
      { id: 'host', displayName: 'Host', connected: true, isHost: true },
      { id: 'guest', displayName: 'Guest', connected: true, isHost: false },
    ],
    assignments: { [assignedCharacterId]: 'guest' },
    dialogueOwners: {},
    pack: roomPack,
    project,
    takes: [],
    exportProgress: null,
    exportComplete: false,
    readyPlayerIds: ['host', 'guest'],
    started: true,
  }
  let currentState = state
  let onRoomState: ((state: RoomState | null) => void) | undefined
  window.studio = {
    getRoom: async () => ({
      state: currentState,
      playerId: 'guest',
      address: '127.0.0.1:4318',
    }),
    onRoomState: (callback: (state: RoomState | null) => void) => {
      onRoomState = callback
      return () => undefined
    },
    listProjects: async () => [project],
    listPacks: async () => [roomPack],
    roomGetPreviewUrl: async () => 'studio-media://room/preview',
    roomGetAssetUrl: async (ref: string) => `studio-media://room/asset/${ref}`,
    roomGetWaveform: async () => ({ original: [], take: [] }),
    roomReleaseRole: async (roleId: string) => {
      const assignments = { ...currentState.assignments }
      delete assignments[roleId]
      currentState = { ...currentState, assignments }
      onRoomState?.(currentState)
    },
    roomClaimRole: async (roleId: string) => {
      currentState = {
        ...currentState,
        assignments: { ...currentState.assignments, [roleId]: 'guest' },
      }
      onRoomState?.(currentState)
    },
  } as unknown as DesktopApi

  const { container } = render(
    <MemoryRouter>
      <RoomPage />
    </MemoryRouter>,
  )

  await waitFor(() =>
    expect(screen.getByLabelText('Video player')).toHaveTextContent(
      'My first line',
    ),
  )
  await waitFor(() =>
    expect(container.querySelector('video')?.currentTime).toBe(8),
  )
  expect(screen.getByLabelText('Video player')).toHaveTextContent('Cue 00:08')
  const video = container.querySelector('video')!
  video.currentTime = 9.5
  fireEvent.timeUpdate(video)
  expect(screen.getByLabelText('Video player')).toHaveTextContent('Cue 00:09')
  expect(screen.getByRole('button', { name: /My first line/ })).toHaveClass(
    'border-primary',
  )
  const dialogueList = screen.getByRole('region', { name: 'Dialogue list' })
  const characterFilter = within(dialogueList).getByRole('combobox', {
    name: 'Character',
  })
  expect(
    within(characterFilter).getByRole('option', { name: 'A' }),
  ).toBeVisible()
  expect(
    within(dialogueList).getByRole('button', {
      name: /Another character speaks first/,
    }),
  ).toBeVisible()
  fireEvent.change(characterFilter, { target: { value: assignedCharacterId } })
  expect(
    within(dialogueList).queryByRole('button', {
      name: /Another character speaks first/,
    }),
  ).toBeNull()
  expect(
    within(dialogueList).getByRole('button', {
      name: /My second line/,
    }),
  ).toBeVisible()
  expect(screen.queryByRole('button', { name: 'CHANGE ROLES' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Choose roles' }))
  const roleDialog = screen.getByRole('dialog', { name: 'Choose roles' })
  expect(within(roleDialog).getByRole('checkbox', { name: /A/ })).toBeChecked()
  fireEvent.click(within(roleDialog).getByRole('checkbox', { name: /A/ }))
  await waitFor(() =>
    expect(
      within(roleDialog).getByRole('checkbox', { name: /A/ }),
    ).not.toBeChecked(),
  )
  fireEvent.click(within(roleDialog).getByRole('checkbox', { name: /Other/ }))
  await waitFor(() =>
    expect(screen.getByLabelText('Video player')).toHaveTextContent(
      'Another character speaks first',
    ),
  )
})

it('advances the room waveform from audio frames without reloading it', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
    () => undefined,
  )
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const state: RoomState = {
    code: 'ABC234',
    hostPlayerId: 'host',
    players: [
      { id: 'host', displayName: 'Host', connected: true, isHost: true },
    ],
    assignments: { [pack.characters[0].id]: 'host' },
    dialogueOwners: {},
    pack,
    project,
    takes: [],
    exportProgress: null,
    exportComplete: false,
    readyPlayerIds: ['host'],
    started: true,
  }
  const roomGetWaveform = vi.fn(async () => ({
    original: [0, 0.5, 0],
    take: null,
    sourceDurationSeconds: 2,
    windowStartSeconds: -1,
    windowSeconds: 4,
  }))
  window.studio = {
    getRoom: async () => ({
      state,
      playerId: 'host',
      address: '127.0.0.1:4318',
    }),
    onRoomState: () => () => undefined,
    listProjects: async () => [project],
    listPacks: async () => [pack],
    roomGetPreviewUrl: async () => 'studio-media://room/preview',
    roomGetAssetUrl: async (ref: string) => `studio-media://room/asset/${ref}`,
    roomGetWaveform,
  } as unknown as DesktopApi

  const { container } = render(
    <MemoryRouter>
      <RoomPage />
    </MemoryRouter>,
  )
  const button = await screen.findByRole('button', { name: 'Hear clip' })
  await waitFor(() => expect(button).toBeEnabled())
  await waitFor(() => expect(roomGetWaveform).toHaveBeenCalledTimes(1))
  fireEvent.click(button)
  await waitFor(() => expect(frames.length).toBeGreaterThan(0))
  const audio = container.querySelector('audio')!
  audio.currentTime = 0.5
  act(() => frames.shift()?.(0))
  expect(
    container.querySelector('path[stroke="#b8ffea"]')?.getAttribute('d'),
  ).toBe('M375 0 V140')
  expect(roomGetWaveform).toHaveBeenCalledTimes(1)
})

it('highlights Watch dub after every multiplayer line has a selected take', async () => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
    () => undefined,
  )
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() }
  class FakeAudioContext {
    destination = {}
    createMediaElementSource = () => ({
      connect: vi.fn(),
      disconnect: vi.fn(),
    })
    createGain = () => gain
    resume = async () => undefined
    close = async () => undefined
  }
  vi.stubGlobal('AudioContext', FakeAudioContext)
  class MediaURL extends URL {
    static createObjectURL = vi.fn(() => 'blob:room-backing')
    static revokeObjectURL = vi.fn()
  }
  vi.stubGlobal('URL', MediaURL)
  const firstRole = pack.characters[0].id
  const secondRole = 'second-role'
  const secondLine = 'second-line'
  const roomPack = {
    ...pack,
    backingTrackRef: '_backing_track.ogg',
    characters: [
      ...pack.characters,
      { ...pack.characters[0], id: secondRole, name: 'B' },
    ],
    dialogues: [
      pack.dialogues[0],
      {
        ...pack.dialogues[0],
        id: secondLine,
        characterIds: [secondRole],
        timestampSeconds: 4,
      },
    ],
  }
  const roomProject = {
    ...project,
    enabledCharacterIds: [firstRole, secondRole],
  }
  const state: RoomState = {
    code: 'ABC234',
    hostPlayerId: 'host',
    players: [
      { id: 'host', displayName: 'Host', connected: true, isHost: true },
      { id: 'guest', displayName: 'Guest', connected: true, isHost: false },
    ],
    assignments: { [firstRole]: 'host', [secondRole]: 'guest' },
    dialogueOwners: {},
    pack: roomPack,
    project: roomProject,
    takes: [],
    exportProgress: null,
    exportComplete: false,
    readyPlayerIds: ['host', 'guest'],
    started: true,
  }
  let onRoomState: ((state: RoomState | null) => void) | undefined
  const roomRenderPreview = vi.fn(
    async () => 'studio-media://room-local/preview.mp4',
  )
  const roomExport = vi.fn(async () => null)
  const roomCancelRender = vi.fn(async () => undefined)
  window.studio = {
    getRoom: async () => ({
      state,
      playerId: 'guest',
      address: '127.0.0.1:4318',
    }),
    onRoomState: (callback: (state: RoomState | null) => void) => {
      onRoomState = callback
      return () => undefined
    },
    listProjects: async () => [project],
    listPacks: async () => [roomPack],
    roomGetPreviewUrl: async () => 'studio-media://room/preview',
    roomGetAssetUrl: async (ref: string) => `studio-media://room/asset/${ref}`,
    roomGetBackingTrackBytes: async () => new Uint8Array([1, 2, 3]),
    roomGetWaveform: async () => null,
    roomGetTakeUrl: async (takeId: string) =>
      `studio-media://room/take/${takeId}`,
    roomRenderPreview,
    onRoomRenderProgress: () => () => undefined,
    roomCancelRender,
    roomExport,
    roomGetExportUrl: async () => 'studio-media://room/export',
  } as unknown as DesktopApi

  render(
    <MemoryRouter>
      <RoomPage />
    </MemoryRouter>,
  )
  const button = await screen.findByRole('button', { name: 'Watch dub' })
  expect(button).not.toHaveClass('watch-ready')
  fireEvent.click(button)
  expect(
    await screen.findByRole('dialog', { name: 'Watch dub' }),
  ).toHaveTextContent('0 of 2 lines recorded. Missing lines play silently.')
  expect(
    screen.queryByLabelText('Use backing track in export'),
  ).not.toBeInTheDocument()
  expect(
    screen.queryByLabelText('Require all lines in export'),
  ).not.toBeInTheDocument()
  const volume = await screen.findByRole('slider', {
    name: 'Backing track volume',
  })
  expect(
    screen.getByRole('dialog', { name: 'Watch dub' }).querySelector('audio'),
  ).toHaveAttribute('src', 'blob:room-backing')
  fireEvent.change(volume, { target: { value: '150' } })
  expect(gain.gain.value).toBe(1.5)
  expect(screen.getByRole('button', { name: 'Export video' })).toBeEnabled()
  await waitFor(() => expect(roomRenderPreview).toHaveBeenCalledWith())
  fireEvent.click(screen.getByRole('button', { name: 'Close watch dub' }))
  await waitFor(() => expect(roomCancelRender).toHaveBeenCalled())

  const take = (dialogueId: string, id: string): RecordingTake => ({
    id,
    projectId: roomProject.id,
    dialogueId,
    fileRef: `${id}.wav`,
    mimeType: 'audio/wav',
    durationSeconds: 1,
    offsetSeconds: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    selected: true,
  })
  const firstTake = take(
    pack.dialogues[0].id,
    '00000000-0000-4000-8000-000000000011',
  )
  const secondTake = take(secondLine, '00000000-0000-4000-8000-000000000012')
  act(() => onRoomState?.({ ...state, takes: [firstTake] }))
  expect(button).not.toHaveClass('watch-ready')
  act(() => onRoomState?.({ ...state, takes: [firstTake, secondTake] }))
  expect(button).toHaveClass('watch-ready')

  fireEvent.click(button)
  const dialog = await screen.findByRole('dialog', { name: 'Watch dub' })
  expect(dialog).toHaveClass('watch-dub-dialog')
  expect(
    screen.queryByRole('button', { name: 'Replay' }),
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Re-render' })).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'Export video' }),
  ).toBeInTheDocument()
  await waitFor(() =>
    expect(dialog.querySelector('video')).toHaveAttribute(
      'src',
      'studio-media://room-local/preview.mp4',
    ),
  )
  const video = dialog.querySelector('video')!
  const audio = dialog.querySelector('audio')!
  Object.defineProperty(video, 'paused', { configurable: true, value: false })
  video.currentTime = 2.5
  fireEvent.playing(video)
  await waitFor(() => expect(audio.currentTime).toBe(2.5))
  expect(screen.getByRole('button', { name: 'Export video' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Export video' }))
  await waitFor(() =>
    expect(roomExport).toHaveBeenCalledWith({
      useBackingTrack: true,
      requireComplete: false,
      backingVolume: 1.5,
      fastMode: false,
    }),
  )
})

it('shows voice effects for an assigned multiplayer dialogue and saves a preset', async () => {
  const dialogue = pack.dialogues[0]
  const playerId = 'host'
  const state: RoomState = {
    code: 'ABC234',
    hostPlayerId: playerId,
    players: [
      { id: playerId, displayName: 'Host', connected: true, isHost: true },
    ],
    assignments: Object.fromEntries(
      dialogue.characterIds.map((id) => [id, playerId]),
    ),
    dialogueOwners: {},
    pack,
    project,
    takes: [],
    exportProgress: null,
    exportComplete: false,
    readyPlayerIds: [playerId],
    started: true,
  }
  let onRoomState: ((state: RoomState | null) => void) | undefined
  let releaseFirstSave: (() => void) | undefined
  const roomSetVoiceEffect = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirstSave = resolve
        }),
    )
    .mockResolvedValue(undefined)
  window.studio = {
    getRoom: async () => ({ state, playerId, address: '127.0.0.1:4318' }),
    onRoomState: (callback: (state: RoomState | null) => void) => {
      onRoomState = callback
      return () => undefined
    },
    listProjects: async () => [project],
    listPacks: async () => [pack],
    roomGetPreviewUrl: async () => 'studio-media://room/preview',
    roomGetAssetUrl: async (ref: string) => `studio-media://room/asset/${ref}`,
    roomGetWaveform: async () => ({ original: [], take: [] }),
    roomSetVoiceEffect,
  } as unknown as DesktopApi

  render(
    <MemoryRouter>
      <RoomPage />
    </MemoryRouter>,
  )
  const panel = await screen.findByRole('region', { name: 'Voice effect' })
  fireEvent.change(panel.querySelector('select')!, {
    target: { value: 'deep' },
  })
  await waitFor(() =>
    expect(roomSetVoiceEffect).toHaveBeenCalledWith(
      dialogue.id,
      expect.objectContaining({ preset: 'deep' }),
    ),
  )
  expect(panel.querySelector('select')).toHaveValue('deep')
  const pitch = within(panel)
    .getByText('Pitch')
    .closest('label')!
    .querySelector('input')!
  fireEvent.change(pitch, { target: { value: '3' } })
  fireEvent.change(pitch, { target: { value: '6' } })
  expect(pitch).toHaveValue('6')
  expect(roomSetVoiceEffect).toHaveBeenCalledTimes(1)

  act(() =>
    onRoomState?.({
      ...state,
      project: {
        ...project,
        voiceEffects: { [dialogue.id]: roomSetVoiceEffect.mock.calls[0][1] },
      },
    }),
  )
  expect(pitch).toHaveValue('6')
  await act(async () => releaseFirstSave?.())
  await waitFor(() => expect(roomSetVoiceEffect).toHaveBeenCalledTimes(3))
  expect(roomSetVoiceEffect.mock.calls[2][1]).toMatchObject({
    preset: 'custom',
    pitch: 6,
  })
})

it('keeps room clip and recording playback exclusive', async () => {
  const pause = vi
    .spyOn(HTMLMediaElement.prototype, 'pause')
    .mockImplementation(() => undefined)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const take: RecordingTake = {
    id: '00000000-0000-4000-8000-000000000011',
    projectId: project.id,
    dialogueId: pack.dialogues[0].id,
    fileRef: 'take.webm',
    mimeType: 'audio/webm',
    durationSeconds: 1,
    offsetSeconds: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    selected: true,
  }
  const state: RoomState = {
    code: 'ABC234',
    hostPlayerId: 'host',
    players: [
      { id: 'host', displayName: 'Host', connected: true, isHost: true },
    ],
    assignments: { [pack.characters[0].id]: 'host' },
    dialogueOwners: {},
    pack,
    project,
    takes: [take],
    exportProgress: null,
    exportComplete: false,
    readyPlayerIds: ['host'],
    started: true,
  }
  window.studio = {
    getRoom: async () => ({
      state,
      playerId: 'host',
      address: '127.0.0.1:4318',
    }),
    onRoomState: () => () => undefined,
    listProjects: async () => [project],
    listPacks: async () => [pack],
    roomGetPreviewUrl: async () => 'studio-media://room/preview',
    roomGetAssetUrl: async (ref: string) => `studio-media://room/asset/${ref}`,
    roomGetTakeUrl: async () => 'studio-media://room/take',
    roomGetWaveform: async () => ({
      original: [0, 0.5, 0],
      take: [0, 0.5, 0],
      sourceDurationSeconds: 2,
      windowStartSeconds: -1,
      windowSeconds: 4,
    }),
  } as unknown as DesktopApi

  const { container } = render(
    <MemoryRouter>
      <RoomPage />
    </MemoryRouter>,
  )
  const hearClip = await screen.findByRole('button', { name: 'Hear clip' })
  await waitFor(() => expect(hearClip).toBeEnabled())
  const playRecording = await screen.findByRole('button', {
    name: 'Play recording',
  })
  await waitFor(() => expect(playRecording).toBeEnabled())
  fireEvent.click(hearClip)
  const originalAudio = container.querySelector<HTMLAudioElement>(
    'audio[src^="studio-media://room/asset/"]',
  )!
  pause.mockClear()
  fireEvent.click(playRecording)
  expect(pause.mock.instances).toContain(originalAudio)
  const recordingAudio = container.querySelector<HTMLAudioElement>(
    'audio[src="studio-media://room/take"]',
  )!
  const pointer = container.querySelector('path[stroke="#b8ffea"]')!
  const startPosition = pointer.getAttribute('d')
  recordingAudio.currentTime = 0.5
  fireEvent.timeUpdate(recordingAudio)
  expect(pointer.getAttribute('d')).not.toBe(startPosition)
  pause.mockClear()
  fireEvent.click(screen.getByRole('button', { name: 'Hear clip' }))
  expect(pause.mock.instances).toContain(recordingAudio)
})
