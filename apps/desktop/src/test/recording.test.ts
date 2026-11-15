import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecordingTakeSchema } from '@studio/shared'
import { preferredRecordingMimeType } from '@/hooks/useMicrophoneRecorder'

const take = {
  id: '00000000-0000-4000-8000-000000000011',
  projectId: '00000000-0000-4000-8000-000000000001',
  dialogueId: 'sample:0',
  fileRef: '00000000-0000-4000-8000-000000000011.webm',
  mimeType: 'audio/webm;codecs=opus',
  durationSeconds: 1.25,
  offsetSeconds: -0.1,
  createdAt: '2026-01-01T00:00:00.000Z',
  selected: true,
}

afterEach(() => vi.unstubAllGlobals())

describe('recording metadata and format detection', () => {
  it('validates take identifiers, timing, and creation time', () => {
    expect(RecordingTakeSchema.parse(take)).toEqual(take)
    expect(
      RecordingTakeSchema.safeParse({ ...take, offsetSeconds: Number.NaN })
        .success,
    ).toBe(false)
    expect(
      RecordingTakeSchema.safeParse({ ...take, fileRef: '../other.webm' })
        .success,
    ).toBe(false)
    expect(
      RecordingTakeSchema.safeParse({ ...take, createdAt: 'yesterday' })
        .success,
    ).toBe(false)
  })

  it('chooses a runtime-supported format and falls back to the browser default', () => {
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (type: string) => type === 'audio/ogg;codecs=opus',
    })
    expect(preferredRecordingMimeType()).toBe('audio/ogg;codecs=opus')
    vi.stubGlobal('MediaRecorder', { isTypeSupported: () => false })
    expect(preferredRecordingMimeType()).toBeUndefined()
  })
})
