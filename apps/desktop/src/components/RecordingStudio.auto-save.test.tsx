import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
    setDeviceId: vi.fn(),
    status: 'idle',
    level: 0,
    error: null,
    refreshDevices: async () => undefined,
    start: vi.fn(
      async (
        seconds: number,
        onCompleted: (take: {
          blob: Blob
          mimeType: string
          durationSeconds: number
        }) => void,
        onStarted: () => void,
        onStopped: (automatic: boolean) => void,
      ) => {
        onStarted()
        onStopped(true)
        onCompleted({
          blob: new Blob(['recorded'], { type: 'audio/webm' }),
          mimeType: 'audio/webm',
          durationSeconds: seconds,
        })
      },
    ),
    stop: vi.fn(),
  }),
}))
import { RecordingStudio } from './RecordingStudio'

describe('automatic recording persistence', () => {
  it('saves a finished take without a separate Save recording action', async () => {
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
    const saveTake = vi.fn().mockResolvedValue(undefined)
    const onChanged = vi.fn().mockResolvedValue(undefined)
    const onRecordingStart = vi.fn()
    const onRecordingStop = vi.fn()
    window.studio = { saveTake } as unknown as DesktopApi
    render(
      <RecordingStudio
        project={project}
        dialogue={pack.dialogues[0]}
        takes={[]}
        onChanged={onChanged}
        onHearClip={vi.fn()}
        onStopClip={vi.fn()}
        clipPlaying={false}
        canHearClip
        maxDurationSeconds={1.25}
        onRecordingStart={onRecordingStart}
        onRecordingStop={onRecordingStop}
        onRecordingProgress={vi.fn()}
        onRecordingSample={vi.fn()}
        onPlayRecording={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Start recording' }))
    expect(onRecordingStart).toHaveBeenCalledOnce()
    await waitFor(() => expect(saveTake).toHaveBeenCalledOnce())
    expect(saveTake.mock.calls[0][0]).toMatchObject({
      projectId: project.id,
      dialogueId: pack.dialogues[0].id,
      durationSeconds: 1.25,
      offsetSeconds: 0,
    })
    expect(onRecordingStart).toHaveBeenCalledOnce()
    expect(onRecordingStop).toHaveBeenCalledWith(true)
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(
      screen.queryByRole('button', { name: 'Save recording' }),
    ).not.toBeInTheDocument()
  })
})
