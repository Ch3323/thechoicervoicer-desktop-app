import {
  act,
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
  type ExportResult,
  type RecordingTake,
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
const take: RecordingTake = {
  id: '00000000-0000-4000-8000-000000000002',
  projectId: project.id,
  dialogueId: pack.dialogues[0].id,
  fileRef: '00000000-0000-4000-8000-000000000002.webm',
  mimeType: 'audio/webm',
  durationSeconds: 3,
  offsetSeconds: 0.5,
  createdAt: project.createdAt,
  selected: true,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('watch dub', () => {
  it('uses saved take gain in the final cut audio without adding controls', async () => {
    const getPreviewTakeAudio = vi.fn(async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'audio/mp4',
    }))
    class MediaURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:boosted-take')
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', MediaURL)
    window.studio = {
      getPreviewUrl: async () => 'studio-media://pack/preview.mp4',
      getPreviewTakeAudio,
      cancelExport: async () => undefined,
      onExportProgress: () => () => undefined,
    } as unknown as DesktopApi
    const { container } = render(
      <WatchDubDialog
        project={project}
        pack={pack}
        takes={[{ ...take, gainDb: 12 }]}
        open
        onClose={vi.fn()}
        fastMode={false}
      />,
    )
    await waitFor(() =>
      expect(getPreviewTakeAudio).toHaveBeenCalledWith(
        'single',
        project.id,
        take.dialogueId,
        take.id,
        undefined,
        12,
      ),
    )
    await waitFor(() =>
      expect(container.querySelector('audio')?.getAttribute('src')).toBe(
        'blob:boosted-take',
      ),
    )
    expect(screen.queryByText('Recorded tracks')).toBeNull()
    expect(screen.queryByLabelText(/Session voice level/)).toBeNull()
  })

  it('starts the backing track at the video position when it loads late', async () => {
    let finishBacking!: (bytes: Uint8Array) => void
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
      () => undefined,
    )
    class MediaURL extends URL {
      static createObjectURL = vi.fn(() => 'blob:late-backing')
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', MediaURL)
    window.studio = {
      getPreviewUrl: async () => 'studio-media://pack/preview.mp4',
      getBackingTrackBytes: () =>
        new Promise<Uint8Array>((resolve) => {
          finishBacking = resolve
        }),
      cancelExport: async () => undefined,
      onExportProgress: () => () => undefined,
    } as unknown as DesktopApi
    const { container } = render(
      <WatchDubDialog
        project={project}
        pack={{ ...pack, backingTrackRef: '_backing_track.ogg' }}
        takes={[]}
        open
        onClose={vi.fn()}
        fastMode={false}
      />,
    )
    const video = await waitFor(() => {
      const element = container.querySelector('video')
      expect(element).not.toBeNull()
      return element!
    })
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    video.currentTime = 4
    fireEvent.playing(video)
    await act(async () => finishBacking(new Uint8Array([1, 2, 3])))
    const backing = await waitFor(() => {
      const element = container.querySelector('audio')
      expect(element).toHaveAttribute('src', 'blob:late-backing')
      return element!
    })
    expect(backing.currentTime).toBe(4)
    expect(play.mock.contexts).toContain(backing)
  })

  it('changes backing track volume during preview without rendering again', async () => {
    const packWithBacking = { ...pack, backingTrackRef: '_backing_track.ogg' }
    const getPreviewUrl = vi.fn(async () => 'studio-media://pack/preview.mp4')
    const getPreviewTakeAudio = vi.fn(async () => ({
      bytes: new Uint8Array([4, 5, 6]),
      mimeType: 'audio/webm',
    }))
    const exportProject = vi.fn(async () => null)
    const cancelExport = vi.fn(async () => undefined)
    const gains: Array<{
      gain: { value: number }
      connect: ReturnType<typeof vi.fn>
      disconnect: ReturnType<typeof vi.fn>
    }> = []
    class FakeAudioContext {
      destination = {}
      createMediaElementSource = () => ({
        connect: vi.fn(),
        disconnect: vi.fn(),
      })
      createGain = () => {
        const gain = {
          gain: { value: 1 },
          connect: vi.fn(),
          disconnect: vi.fn(),
        }
        gains.push(gain)
        return gain
      }
      // Audio playback must start even while the context is resuming.
      resume = () => new Promise<void>(() => undefined)
      close = async () => undefined
    }
    vi.stubGlobal('AudioContext', FakeAudioContext)
    class MediaURL extends URL {
      static createObjectURL = vi.fn((blob: Blob) =>
        blob.type === 'audio/webm'
          ? 'blob:selected-take'
          : 'blob:backing-track',
      )
      static revokeObjectURL = vi.fn()
    }
    vi.stubGlobal('URL', MediaURL)
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined)
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined)
    window.studio = {
      getPreviewUrl,
      getPreviewTakeAudio,
      exportProject,
      cancelExport,
      getBackingTrackBytes: async () => new Uint8Array([1, 2, 3]),
      onExportProgress: () => () => undefined,
    } as unknown as DesktopApi

    const { container } = render(
      <WatchDubDialog
        project={project}
        pack={packWithBacking}
        takes={[take]}
        open
        onClose={vi.fn()}
        fastMode={false}
      />,
    )
    await waitFor(() =>
      expect(container.querySelector('video[controls]')).not.toBeNull(),
    )
    await waitFor(() =>
      expect(container.querySelectorAll('audio')).toHaveLength(2),
    )
    expect(container.querySelectorAll('audio')[0]).toHaveAttribute(
      'src',
      'blob:backing-track',
    )
    expect(container.querySelectorAll('audio')[1]).toHaveAttribute(
      'src',
      'blob:selected-take',
    )
    expect(container.querySelectorAll('audio')[1]).not.toHaveAttribute(
      'crossorigin',
    )
    expect(getPreviewTakeAudio).toHaveBeenCalledWith(
      'single',
      project.id,
      take.dialogueId,
      take.id,
      undefined,
    )
    expect(getPreviewUrl).toHaveBeenCalledWith(pack.id)
    const video = container.querySelector('video')!
    const audio = container.querySelector('audio')!
    const selectedAudio = container.querySelectorAll('audio')[1]
    expect(video.muted).toBe(true)
    video.currentTime = 2.5
    expect(screen.queryByRole('button', { name: 'Play preview' })).toBeNull()
    Object.defineProperty(video, 'paused', { configurable: true, value: false })
    fireEvent.playing(video)
    await waitFor(() => expect(audio.currentTime).toBe(2.5))
    expect(selectedAudio.currentTime).toBe(1)
    expect(play.mock.contexts).toContain(audio)
    expect(play.mock.contexts).toContain(selectedAudio)
    video.currentTime = 3
    fireEvent.timeUpdate(video)
    expect(audio.currentTime).toBe(3)
    expect(selectedAudio.currentTime).toBe(1.5)
    video.playbackRate = 1.5
    fireEvent.rateChange(video)
    expect(audio.playbackRate).toBe(1.5)
    expect(selectedAudio.playbackRate).toBe(1.5)
    fireEvent.pause(video)
    expect(pause.mock.contexts).toContain(audio)
    expect(pause.mock.contexts).toContain(selectedAudio)
    fireEvent.change(
      screen.getByRole('slider', { name: 'Dubbing track volume' }),
      { target: { value: '40' } },
    )
    expect(selectedAudio.volume).toBe(0.4)
    fireEvent.change(
      screen.getByRole('slider', { name: 'Dubbing track volume' }),
      { target: { value: '150' } },
    )
    expect(selectedAudio.volume).toBe(1)
    expect(gains[0].gain.value).toBe(1.5)
    fireEvent.change(
      screen.getByRole('slider', { name: 'Backing track volume' }),
      {
        target: { value: '50' },
      },
    )
    expect(audio.volume).toBe(0.5)
    fireEvent.change(
      screen.getByRole('slider', { name: 'Backing track volume' }),
      {
        target: { value: '150' },
      },
    )
    expect(gains[1].gain.value).toBe(1.5)
    expect(getPreviewUrl).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Export video' }))
    await waitFor(() =>
      expect(exportProject).toHaveBeenCalledWith(project.id, {
        useBackingTrack: true,
        requireComplete: false,
        backingVolume: 1.5,
        dubbingVolume: 1.5,
        fastMode: false,
      }),
    )
  })

  it('plays the current mix in a modal and offers export there', async () => {
    const getPreviewUrl = vi.fn(async () => 'studio-media://pack/preview.mp4')
    let finishExport!: (result: ExportResult | null) => void
    const exportProject = vi.fn(
      () =>
        new Promise<ExportResult | null>((resolve) => (finishExport = resolve)),
    )
    const cancelExport = vi.fn(async () => undefined)
    window.studio = {
      getPreviewUrl,
      exportProject,
      cancelExport,
      onExportProgress: () => () => undefined,
    } as unknown as DesktopApi
    const onClose = vi.fn()
    const { container } = render(
      <WatchDubDialog
        project={project}
        pack={pack}
        takes={[]}
        open
        onClose={onClose}
        fastMode={false}
      />,
    )
    await waitFor(() => expect(getPreviewUrl).toHaveBeenCalledWith(pack.id))
    await waitFor(() =>
      expect(container.querySelector('video[controls]')).not.toBeNull(),
    )
    expect(
      screen.queryByRole('button', { name: 'Fullscreen video' }),
    ).toBeNull()
    expect(screen.queryByRole('button', { name: 'Replay' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Export video' }))
    await waitFor(() => expect(exportProject).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Close watch dub' }))
    expect(onClose).toHaveBeenCalledOnce()
    expect(cancelExport).toHaveBeenCalledWith(project.id)
    await act(async () =>
      finishExport({
        outputPath: 'C:/done.mp4',
        backingTrackUsed: false,
        warnings: [],
      }),
    )
    expect(screen.queryByText('Exported to C:/done.mp4')).toBeNull()
  })

  it('ignores a preview URL that is still loading when closed', async () => {
    const getPreviewUrl = vi.fn(() => new Promise<string>(() => undefined))
    const cancelExport = vi.fn(async () => undefined)
    window.studio = {
      getPreviewUrl,
      cancelExport,
      onExportProgress: () => () => undefined,
    } as unknown as DesktopApi
    render(
      <WatchDubDialog
        project={project}
        pack={pack}
        takes={[]}
        open
        onClose={vi.fn()}
        fastMode={false}
      />,
    )
    await waitFor(() => expect(getPreviewUrl).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Close watch dub' }))
    expect(cancelExport).toHaveBeenCalledWith(project.id)
  })
})
