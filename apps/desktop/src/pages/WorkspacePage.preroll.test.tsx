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
} from '@studio/shared'

vi.mock('@/hooks/useMicrophoneRecorder', () => ({
  preferredRecordingMimeType: () => 'audio/webm',
  useMicrophoneRecorder: () => ({
    devices: [],
    deviceId: '',
    status: 'idle',
    level: 0,
    error: null,
    refreshDevices: async () => undefined,
    start: vi.fn(async (...args: unknown[]) => {
      const onPreRollStart = args[6] as (() => void) | undefined
      onPreRollStart?.()
    }),
    stop: vi.fn(),
  }),
}))

import { WorkspacePage } from './WorkspacePage'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('recording pre-roll', () => {
  it('starts the pointer before the cue when a new pack begins at video time zero', async () => {
    const pack = parseDubPack({
      id: 'pack-at-zero',
      source: { kind: 'folder', location: 'C:/scene' },
      folderName: 'Opening line',
      files: [
        { path: 'dub_video.ogv' },
        { path: 'opening.wav' },
        {
          path: 'opening.ini',
          text: '[data]\ndub_timestamps=[0]\ndub_characters=["A"]',
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
    window.studio = {
      listProjects: async () => [project],
      listPacks: async () => [pack],
      listTakes: async () => [],
      getPreviewUrl: async () => 'studio-media://pack-at-zero/preview.mp4',
      getAssetUrl: async (_packId: string, ref: string) =>
        `studio-media://pack-at-zero/${ref}`,
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
    Object.defineProperty(audio, 'duration', { configurable: true, value: 1 })
    fireEvent.loadedMetadata(video)
    fireEvent.loadedMetadata(audio)
    const button = await screen.findByRole('button', {
      name: 'Start recording',
    })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)

    const cue = container.querySelector('path[stroke="#f23b9b"]')!
    const pointer = container.querySelector('path[stroke="#b8ffea"]')!
    expect(Number(cue.getAttribute('d')?.match(/M([\d.]+)/)?.[1])).toBeCloseTo(
      333.33,
      1,
    )
    expect(pointer.getAttribute('d')).toBe('M0 0 V140')
  })
})
