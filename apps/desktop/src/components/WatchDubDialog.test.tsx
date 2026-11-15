import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseDubPack,
  type DesktopApi,
  type DubbingProject,
} from '@studio/shared'
import { WatchDubDialog } from './WatchDubDialog'

const pack = parseDubPack({
  id: 'pack-1',
  source: { kind: 'zip', location: 'C:/scene.zip' },
  folderName: 'Scene',
  files: [
    { path: 'dub_video.ogv' },
    { path: 'line.wav' },
    {
      path: 'line.ini',
      text: '[data]\ndub_timestamps=[1]\ndub_characters=["A"]',
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

describe('watch dub', () => {
  it('changes backing track volume during preview without rendering again', async () => {
    const packWithBacking = { ...pack, backingTrackRef: '_backing_track.ogg' }
    const renderDubPreview = vi.fn(async () => 'studio-media://dub/preview.mp4')
    const exportProject = vi.fn(async () => null)
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
      static createObjectURL = vi.fn(() => 'blob:backing-track')
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', MediaURL)
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
      () => undefined,
    )
    window.studio = {
      renderDubPreview,
      exportProject,
      getBackingTrackBytes: async () => new Uint8Array([1, 2, 3]),
      onExportProgress: () => () => undefined,
    } as unknown as DesktopApi

    const { container } = render(
      <WatchDubDialog
        project={project}
        pack={packWithBacking}
        open
        onClose={vi.fn()}
        fastMode={false}
      />,
    )
    await waitFor(() =>
      expect(container.querySelector('video[controls]')).not.toBeNull(),
    )
    await waitFor(() => expect(container.querySelector('audio')).not.toBeNull())
    expect(container.querySelector('audio')).toHaveAttribute(
      'src',
      'blob:backing-track',
    )
    expect(renderDubPreview).toHaveBeenCalledWith(project.id, {
      useBackingTrack: false,
      requireComplete: false,
      backingVolume: 1,
      fastMode: false,
    })
    const video = container.querySelector('video')!
    const audio = container.querySelector('audio')!
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    video.currentTime = 2.5
    fireEvent.playing(video)
    await waitFor(() => expect(audio.currentTime).toBe(2.5))
    fireEvent.change(
      screen.getByRole('slider', { name: 'Backing track volume' }),
      {
        target: { value: '50' },
      },
    )
    expect(gain.gain.value).toBe(0.5)
    fireEvent.change(
      screen.getByRole('slider', { name: 'Backing track volume' }),
      {
        target: { value: '150' },
      },
    )
    expect(gain.gain.value).toBe(1.5)
    expect(renderDubPreview).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Export video' }))
    await waitFor(() =>
      expect(exportProject).toHaveBeenCalledWith(project.id, {
        useBackingTrack: true,
        requireComplete: false,
        backingVolume: 1.5,
        fastMode: false,
      }),
    )
  })

  it('renders the current mix in a modal and offers export there', async () => {
    const renderDubPreview = vi.fn(async () => 'studio-media://dub/preview.mp4')
    const exportProject = vi.fn(async () => null)
    window.studio = {
      renderDubPreview,
      exportProject,
      onExportProgress: () => () => undefined,
    } as unknown as DesktopApi
    const onClose = vi.fn()
    const { container } = render(
      <WatchDubDialog
        project={project}
        pack={pack}
        open
        onClose={onClose}
        fastMode={false}
      />,
    )
    await waitFor(() =>
      expect(renderDubPreview).toHaveBeenCalledWith(project.id, {
        useBackingTrack: false,
        requireComplete: false,
        backingVolume: 1,
        fastMode: false,
      }),
    )
    await waitFor(() =>
      expect(container.querySelector('video[controls]')).not.toBeNull(),
    )
    const video = container.querySelector('video')!
    const requestFullscreen = vi.fn(async () => undefined)
    Object.defineProperty(video, 'requestFullscreen', {
      configurable: true,
      value: requestFullscreen,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen video' }))
    expect(requestFullscreen).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Export video' }))
    await waitFor(() => expect(exportProject).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Close watch dub' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
