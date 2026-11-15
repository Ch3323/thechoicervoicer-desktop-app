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
  type RecordingTake,
} from '@studio/shared'
import { RecordingStudio } from './RecordingStudio'

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
  id: '00000000-0000-4000-8000-000000000011',
  projectId: project.id,
  dialogueId: pack.dialogues[0].id,
  fileRef: '00000000-0000-4000-8000-000000000011.webm',
  mimeType: 'audio/webm',
  durationSeconds: 1,
  offsetSeconds: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  selected: true,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('recording studio controls', () => {
  it('moves a nearly complete take smoothly onto the source end marker', async () => {
    window.studio = {
      getTakeUrl: async () => 'studio-media://take/short.webm',
    } as unknown as DesktopApi
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
      () => undefined,
    )
    const onRecordingProgress = vi.fn()
    const nearCompleteTake = { ...take, durationSeconds: 0.94 }
    const { container } = render(
      <RecordingStudio
        project={project}
        dialogue={pack.dialogues[0]}
        takes={[nearCompleteTake]}
        onChanged={async () => undefined}
        onHearClip={vi.fn()}
        onStopClip={vi.fn()}
        clipPlaying={false}
        canHearClip
        maxDurationSeconds={1}
        onRecordingStart={vi.fn()}
        onRecordingStop={vi.fn()}
        onRecordingProgress={onRecordingProgress}
        onRecordingSample={vi.fn()}
        onPlayRecording={vi.fn().mockResolvedValue(undefined)}
      />,
    )
    const button = await screen.findByRole('button', { name: 'Play recording' })
    fireEvent.click(button)
    const audio = container.querySelector('audio')!
    audio.currentTime = 0.47
    fireEvent.timeUpdate(audio)
    expect(onRecordingProgress).toHaveBeenLastCalledWith(0.5)
    audio.currentTime = 0.94
    fireEvent.ended(audio)
    expect(onRecordingProgress).toHaveBeenLastCalledWith(1)
  })

  it('loads the processed take for recording playback when a voice effect is selected', async () => {
    const getEffectTakeUrl = vi.fn(
      async () => 'studio-media://effect/processed.m4a',
    )
    window.studio = {
      getEffectTakeUrl,
      getTakeUrl: vi.fn(),
    } as unknown as DesktopApi
    const { container } = render(
      <RecordingStudio
        project={project}
        dialogue={pack.dialogues[0]}
        takes={[take]}
        onChanged={async () => undefined}
        onHearClip={vi.fn()}
        onStopClip={vi.fn()}
        clipPlaying={false}
        canHearClip
        maxDurationSeconds={1}
        onRecordingStart={vi.fn()}
        onRecordingStop={vi.fn()}
        onRecordingProgress={vi.fn()}
        onRecordingSample={vi.fn()}
        onPlayRecording={vi.fn().mockResolvedValue(undefined)}
        voiceEffect={{
          preset: 'deep',
          pitch: 0,
          tone: 0,
          texture: 0,
          space: 0,
          echo: 0,
          mod: 0,
        }}
      />,
    )
    await waitFor(() =>
      expect(getEffectTakeUrl).toHaveBeenCalledWith(
        project.id,
        take.dialogueId,
        take.id,
        {
          preset: 'deep',
          pitch: 0,
          tone: 0,
          texture: 0,
          space: 0,
          echo: 0,
          mod: 0,
        },
      ),
    )
    await waitFor(() =>
      expect(container.querySelector('audio')?.getAttribute('src')).toBe(
        'studio-media://effect/processed.m4a',
      ),
    )
  })

  it('keeps microphone settings in a dialog and offers one recording playback button', async () => {
    window.studio = {
      getTakeUrl: async () =>
        'studio-media://take/00000000-0000-4000-8000-000000000011',
    } as unknown as DesktopApi
    const play = vi
      .spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(
      () => undefined,
    )
    const onHearClip = vi.fn()
    const onPlayRecording = vi.fn().mockResolvedValue(undefined)
    const { container, rerender } = render(
      <RecordingStudio
        project={project}
        dialogue={pack.dialogues[0]}
        takes={[take]}
        onChanged={async () => undefined}
        onHearClip={onHearClip}
        onStopClip={vi.fn()}
        clipPlaying={false}
        canHearClip
        maxDurationSeconds={1}
        onRecordingStart={vi.fn()}
        onRecordingStop={vi.fn()}
        onRecordingProgress={vi.fn()}
        onRecordingSample={vi.fn()}
        onPlayRecording={onPlayRecording}
      />,
    )

    const dialog = container.querySelector('dialog')!
    expect(dialog.hasAttribute('open')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Microphone settings' }))
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(screen.getByLabelText('Input device')).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Close microphone settings' }),
    )
    expect(dialog.hasAttribute('open')).toBe(false)

    const recordingButton = await screen.findByRole('button', {
      name: 'Play recording',
    })
    fireEvent.click(recordingButton)
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1))
    expect(onPlayRecording).toHaveBeenCalledWith(take)
    expect(
      container.querySelector('audio[controls],video[controls]'),
    ).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hear clip' }))
    expect(onHearClip).toHaveBeenCalledOnce()
    rerender(
      <RecordingStudio
        project={project}
        dialogue={pack.dialogues[0]}
        takes={[take]}
        onChanged={async () => undefined}
        onHearClip={onHearClip}
        onStopClip={vi.fn()}
        clipPlaying
        canHearClip
        maxDurationSeconds={1}
        onRecordingStart={vi.fn()}
        onRecordingStop={vi.fn()}
        onRecordingProgress={vi.fn()}
        onRecordingSample={vi.fn()}
        onPlayRecording={onPlayRecording}
      />,
    )
    expect(
      screen.getByRole('button', { name: 'Playing · Stop' }),
    ).toBeInTheDocument()
    vi.restoreAllMocks()
  })
})
