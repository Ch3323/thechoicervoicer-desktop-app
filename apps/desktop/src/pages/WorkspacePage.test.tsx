import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseDubPack,
  type DesktopApi,
  type DubbingProject,
  type RecordingTake,
} from '@studio/shared'
import { WorkspacePage } from './WorkspacePage'

const pack = parseDubPack({
  id: 'pack-1',
  source: { kind: 'folder', location: 'C:/scene' },
  folderName: 'Scene',
  files: [
    { path: 'dub_video.ogv' },
    { path: '01_Line.wav' },
    {
      path: '01_Line.ini',
      text: '[data]\ncaption="Hello"\ndub_timestamps=[8.823]\ndub_characters=["A"]',
    },
    { path: '02_Reply.wav' },
    {
      path: '02_Reply.ini',
      text: '[data]\ncaption="Next line"\ndub_timestamps=[12.4]\ndub_characters=["A"]',
    },
  ],
})
const project: DubbingProject = {
  id: '00000000-0000-4000-8000-000000000001',
  packId: pack.id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  enabledCharacterIds: pack.characters.map((character) => character.id),
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('workspace clip preview', () => {
  it('keeps Hear clip playing through video drift and lands on the waveform end marker', async () => {
    window.studio = {
      listProjects: async () => [project],
      listPacks: async () => [pack],
      listTakes: async () => [],
      getPreviewUrl: async () => 'studio-media://pack-1/preview.mp4',
      getAssetUrl: async (_packId: string, ref: string) =>
        `studio-media://pack-1/${ref}`,
      getWaveform: async () => ({
        sourceDurationSeconds: 1.5,
        windowStartSeconds: -1,
        windowSeconds: 3.5,
        original: [0, 0.5, 0],
        take: null,
      }),
    } as unknown as DesktopApi
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
      () => undefined,
    )
    const { container } = render(
      <MemoryRouter initialEntries={[`/workspace/${project.id}`]}>
        <Routes>
          <Route path="/workspace/:projectId" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull())
    const video = container.querySelector('video')!
    const audio = container.querySelector('audio')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 30 })
    Object.defineProperty(audio, 'duration', { configurable: true, value: 1.5 })
    fireEvent.loadedMetadata(video)
    fireEvent.loadedMetadata(audio)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Hear clip' })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Hear clip' }))
    video.currentTime = pack.dialogues[0].timestampSeconds + 1.5
    fireEvent.timeUpdate(video)
    expect(
      screen.getByRole('button', { name: 'Playing · Stop' }),
    ).toBeInTheDocument()

    audio.currentTime = 1.48
    fireEvent.ended(audio)
    expect(
      screen.getByRole('button', { name: 'Hear clip' }),
    ).toBeInTheDocument()
    const playhead = container.querySelector('path[stroke="#b8ffea"]')!
    const endMarker = container.querySelectorAll('path[stroke="#f23b9b"]')[1]
    expect(playhead.getAttribute('d')).toBe(endMarker.getAttribute('d'))
  })

  it('highlights Watch dub only after every dialogue has a selected take', async () => {
    const recordings: RecordingTake[] = pack.dialogues.map(
      (dialogue, index) => ({
        id: `00000000-0000-4000-8000-00000000001${index + 1}`,
        projectId: project.id,
        dialogueId: dialogue.id,
        fileRef: `take-${index}.webm`,
        mimeType: 'audio/webm',
        durationSeconds: 1,
        offsetSeconds: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
        selected: true,
      }),
    )
    const setup = (selectedTakes: RecordingTake[]) => {
      window.studio = {
        listProjects: async () => [project],
        listPacks: async () => [pack],
        listTakes: async () => selectedTakes,
        getPreviewUrl: async () => 'studio-media://pack-1/preview.mp4',
        getAssetUrl: async (_packId: string, ref: string) =>
          `studio-media://pack-1/${ref}`,
        getTakeUrl: async (id: string) => `studio-media://take/${id}`,
        getWaveform: async () => ({
          sourceDurationSeconds: 1,
          windowStartSeconds: -1,
          windowSeconds: 3,
          original: [0, 0.5, 0],
          take: [0, 0.5, 0],
        }),
      } as unknown as DesktopApi
      return render(
        <MemoryRouter initialEntries={[`/workspace/${project.id}`]}>
          <Routes>
            <Route path="/workspace/:projectId" element={<WorkspacePage />} />
          </Routes>
        </MemoryRouter>,
      )
    }

    const partial = setup(recordings.slice(0, 1))
    const button = await screen.findByRole('button', { name: 'Watch dub' })
    expect(button).not.toHaveClass('watch-ready')
    partial.unmount()

    setup(recordings)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Watch dub' })).toHaveClass(
        'watch-ready',
      ),
    )
  })

  it('skips clips outside the chosen roles when navigating', async () => {
    const rolePack = parseDubPack({
      id: 'role-pack',
      source: { kind: 'folder', location: 'C:/scene' },
      folderName: 'Role scene',
      files: [
        { path: 'dub_video.ogv' },
        { path: '01_First.wav' },
        {
          path: '01_First.ini',
          text: '[data]\ncaption="First"\ndub_timestamps=[1]\ndub_characters=["A"]',
        },
        { path: '02_Other.wav' },
        {
          path: '02_Other.ini',
          text: '[data]\ncaption="Other role"\ndub_timestamps=[2]\ndub_characters=["B"]',
        },
        { path: '03_Third.wav' },
        {
          path: '03_Third.ini',
          text: '[data]\ncaption="Third"\ndub_timestamps=[3]\ndub_characters=["A"]',
        },
      ],
    })
    const roleProject: DubbingProject = {
      ...project,
      packId: rolePack.id,
      enabledCharacterIds: [
        rolePack.characters.find((character) => character.name === 'A')!.id,
      ],
    }
    window.studio = {
      listProjects: async () => [roleProject],
      listPacks: async () => [rolePack],
      listTakes: async () => [],
      getPreviewUrl: async () => 'studio-media://role-pack/preview.mp4',
      getAssetUrl: async (_packId: string, assetRef: string) =>
        `studio-media://role-pack/${assetRef}`,
      getWaveform: async () => ({
        sourceDurationSeconds: 1,
        windowStartSeconds: 0,
        windowSeconds: 1,
        original: [0, 0.5, 0],
        take: null,
      }),
    } as unknown as DesktopApi
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
      () => undefined,
    )
    const { container } = render(
      <MemoryRouter initialEntries={[`/workspace/${roleProject.id}`]}>
        <Routes>
          <Route path="/workspace/:projectId" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('button', { name: 'Next clip' })
    expect(screen.getByLabelText('Video player')).toHaveTextContent('First')
    fireEvent.click(screen.getByRole('button', { name: 'Next clip' }))
    expect(screen.getByLabelText('Video player')).toHaveTextContent('Third')
    await waitFor(() =>
      expect(container.querySelector('audio')?.getAttribute('src')).toContain(
        '03_Third.wav',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Previous clip' }))
    expect(screen.getByLabelText('Video player')).toHaveTextContent('First')
    const unselectedRoleClip = screen.getByRole('button', {
      name: /Other role/,
    })
    expect(unselectedRoleClip).toHaveClass('opacity-50')
    fireEvent.click(unselectedRoleClip)
    expect(screen.getByLabelText('Video player')).toHaveTextContent(
      'Other role',
    )
    expect(screen.getByLabelText('Recording studio')).toHaveTextContent(
      '02 / 3',
    )
    expect(unselectedRoleClip).toHaveClass('opacity-50')
  })

  it('navigates only the filtered character when several characters are assigned', async () => {
    const filteredPack = parseDubPack({
      id: 'filtered-pack',
      source: { kind: 'folder', location: 'C:/scene' },
      folderName: 'Filtered scene',
      files: [
        { path: 'dub_video.ogv' },
        { path: '01_First.wav' },
        {
          path: '01_First.ini',
          text: '[data]\ncaption="First A"\ndub_timestamps=[1]\ndub_characters=["A"]',
        },
        { path: '02_Second.wav' },
        {
          path: '02_Second.ini',
          text: '[data]\ncaption="Second B"\ndub_timestamps=[2]\ndub_characters=["B"]',
        },
        { path: '03_Third.wav' },
        {
          path: '03_Third.ini',
          text: '[data]\ncaption="Third A"\ndub_timestamps=[3]\ndub_characters=["A"]',
        },
      ],
    })
    const filteredProject: DubbingProject = {
      ...project,
      packId: filteredPack.id,
      enabledCharacterIds: filteredPack.characters.map(
        (character) => character.id,
      ),
    }
    window.studio = {
      listProjects: async () => [filteredProject],
      listPacks: async () => [filteredPack],
      listTakes: async () => [],
      getPreviewUrl: async () => 'studio-media://filtered-pack/preview.mp4',
      getAssetUrl: async (_packId: string, ref: string) =>
        `studio-media://filtered-pack/${ref}`,
      getWaveform: async () => ({
        sourceDurationSeconds: 1,
        windowStartSeconds: -1,
        windowSeconds: 3,
        original: [0, 0.5, 0],
        take: null,
      }),
    } as unknown as DesktopApi
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
      () => undefined,
    )
    render(
      <MemoryRouter initialEntries={[`/workspace/${filteredProject.id}`]}>
        <Routes>
          <Route path="/workspace/:projectId" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByRole('button', { name: 'Next clip' })
    const character = screen.getByLabelText('Character')
    const a = filteredPack.characters.find((item) => item.name === 'A')!
    const b = filteredPack.characters.find((item) => item.name === 'B')!
    fireEvent.change(character, { target: { value: a.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Next clip' }))
    expect(screen.getByLabelText('Video player')).toHaveTextContent('Third A')
    fireEvent.click(screen.getByRole('button', { name: 'Previous clip' }))
    expect(screen.getByLabelText('Video player')).toHaveTextContent('First A')

    fireEvent.change(character, { target: { value: b.id } })
    fireEvent.click(screen.getByRole('button', { name: 'Next clip' }))
    expect(screen.getByLabelText('Video player')).toHaveTextContent('Second B')
  })

  it('uses one Hear clip button to start the source audio and video at the dialogue time', async () => {
    window.studio = {
      listProjects: async () => [project],
      listPacks: async () => [pack],
      listTakes: async () => [],
      getPreviewUrl: async () => 'studio-media://pack-1/preview.mp4',
      updateVoiceEffect: async () => project,
      getAssetUrl: async (_packId: string, assetRef: string) =>
        `studio-media://pack-1/${assetRef}`,
      getWaveform: async () => ({
        sourceDurationSeconds: 1.5,
        windowStartSeconds: 0,
        windowSeconds: 1.5,
        original: [0, 0.5, 0],
        take: null,
      }),
    } as unknown as DesktopApi
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined)
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined)

    const { container } = render(
      <MemoryRouter initialEntries={[`/workspace/${project.id}`]}>
        <Routes>
          <Route path="/workspace/:projectId" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>,
    )
    const button = await screen.findByRole('button', { name: 'Hear clip' })
    await waitFor(() => expect(container.querySelector('video')).not.toBeNull())
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull())
    const video = container.querySelector('video')!
    const audio = container.querySelector('audio')!
    Object.defineProperty(video, 'duration', { configurable: true, value: 30 })
    Object.defineProperty(audio, 'duration', { configurable: true, value: 1.5 })
    fireEvent.loadedMetadata(video)
    fireEvent.loadedMetadata(audio)
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)

    expect(video.currentTime).toBeCloseTo(8.823)
    expect(audio.currentTime).toBe(0)
    expect(video.muted).toBe(true)
    expect(play).toHaveBeenCalledTimes(2)
    expect(
      container.querySelector('video[controls], audio[controls]'),
    ).toBeNull()
    const playingButton = screen.getByRole('button', { name: 'Playing · Stop' })
    const pausesBeforePreset = pause.mock.calls.length
    fireEvent.change(screen.getByLabelText('Preset'), {
      target: { value: 'deep' },
    })
    expect(pause.mock.calls.length).toBe(pausesBeforePreset)
    expect(screen.getByRole('button', { name: 'Playing · Stop' })).toBeEnabled()
    fireEvent.click(playingButton)
    expect(screen.getByRole('button', { name: 'Hear clip' })).toBeEnabled()
    expect(screen.queryByLabelText('Dialogue timeline')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Selected dialogue')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Video player')).toHaveTextContent('Hello')

    const videoSwitch = screen.getByRole('switch', { name: 'Play clip video' })
    expect(videoSwitch).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(videoSwitch)
    expect(videoSwitch).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(videoSwitch)

    fireEvent.click(screen.getByRole('button', { name: 'Choose roles' }))
    const rolesDialog = screen.getByLabelText('Choose roles')
    expect(rolesDialog).toHaveAttribute('open')
    expect(rolesDialog).toHaveTextContent('Choose your roles')
    expect(screen.getByRole('checkbox', { name: 'Dub A' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Close roles' }))
    expect(rolesDialog).not.toHaveAttribute('open')

    fireEvent.click(screen.getByRole('button', { name: /Next line/ }))
    await waitFor(() =>
      expect(container.querySelector('audio')?.getAttribute('src')).toContain(
        '02_Reply.wav',
      ),
    )
    fireEvent.loadedMetadata(container.querySelector('audio')!)
    const nextButton = screen.getByRole('button', { name: 'Hear clip' })
    await waitFor(() => expect(nextButton).toBeEnabled())
    fireEvent.click(nextButton)
    expect(video.currentTime).toBeCloseTo(12.4)
    expect(play).toHaveBeenCalledTimes(4)
  })

  it('plays a selected recording with the muted video at its timeline offset', async () => {
    const take: RecordingTake = {
      id: '00000000-0000-4000-8000-000000000011',
      projectId: project.id,
      dialogueId: pack.dialogues[0].id,
      fileRef: 'take.webm',
      mimeType: 'audio/webm',
      durationSeconds: 1,
      offsetSeconds: 0.25,
      createdAt: '2026-01-01T00:00:00.000Z',
      selected: true,
    }
    window.studio = {
      listProjects: async () => [project],
      listPacks: async () => [pack],
      listTakes: async () => [take],
      getPreviewUrl: async () => 'studio-media://pack-1/preview.mp4',
      getAssetUrl: async (_packId: string, assetRef: string) =>
        `studio-media://pack-1/${assetRef}`,
      getTakeUrl: async () => 'studio-media://take/take.webm',
      getEffectTakeUrl: async () => 'studio-media://effect/processed.m4a',
      updateVoiceEffect: async () => project,
      getWaveform: async () => ({
        sourceDurationSeconds: 1.5,
        windowStartSeconds: 0,
        windowSeconds: 1.5,
        original: [0, 0.5, 0],
        take: [0, 0.3, 0],
      }),
    } as unknown as DesktopApi
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined)
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined)

    const { container } = render(
      <MemoryRouter initialEntries={[`/workspace/${project.id}`]}>
        <Routes>
          <Route path="/workspace/:projectId" element={<WorkspacePage />} />
        </Routes>
      </MemoryRouter>,
    )
    const video = await waitFor(() => {
      const element = container.querySelector('video')
      expect(element).not.toBeNull()
      return element!
    })
    Object.defineProperty(video, 'duration', { configurable: true, value: 30 })
    fireEvent.loadedMetadata(video)
    const button = await screen.findByRole('button', { name: 'Play recording' })
    fireEvent.click(button)
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2))
    expect(video.currentTime).toBeCloseTo(9.073)
    expect(video.muted).toBe(true)
    expect(
      container.querySelector('audio[src="studio-media://take/take.webm"]'),
    ).not.toBeNull()
    const recordingAudio = container.querySelector(
      'audio[src="studio-media://take/take.webm"]',
    ) as HTMLAudioElement
    fireEvent.play(recordingAudio)
    expect(screen.getByRole('button', { name: 'Stop playback' })).toBeEnabled()
    recordingAudio.currentTime = 0.98
    fireEvent.timeUpdate(recordingAudio)
    expect(screen.getByRole('button', { name: 'Stop playback' })).toBeEnabled()
    const pointerBeforeVideoEnd = container
      .querySelector('path[stroke="#b8ffea"]')
      ?.getAttribute('d')
    video.currentTime = 10.073
    fireEvent.timeUpdate(video)
    expect(
      container.querySelector('path[stroke="#b8ffea"]')?.getAttribute('d'),
    ).toBe(pointerBeforeVideoEnd)
    const pausesBeforePreset = pause.mock.calls.length
    fireEvent.change(screen.getByLabelText('Preset'), {
      target: { value: 'deep' },
    })
    expect(pause.mock.calls.length).toBeGreaterThan(pausesBeforePreset)
    expect(screen.queryByRole('button', { name: 'Stop playback' })).toBeNull()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Play recording' }),
      ).toBeEnabled(),
    )
  })
})
