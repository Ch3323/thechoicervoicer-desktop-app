import { describe, expect, it } from 'vitest'
import { RecordingTakeSchema, type AudioTimeline } from '@studio/shared'
import { buildFilterGraph } from '../../electron/export'

describe('recorded track gain', () => {
  it('accepts old takes without a gain and validates the saved range', () => {
    const take = {
      id: '00000000-0000-4000-8000-000000000001',
      projectId: '00000000-0000-4000-8000-000000000002',
      dialogueId: 'line-1',
      fileRef: '00000000-0000-4000-8000-000000000001.wav',
      mimeType: 'audio/wav',
      durationSeconds: 1,
      offsetSeconds: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      selected: true,
    }
    expect(RecordingTakeSchema.parse(take).gainDb).toBeUndefined()
    expect(RecordingTakeSchema.parse({ ...take, gainDb: 24 }).gainDb).toBe(24)
    expect(() => RecordingTakeSchema.parse({ ...take, gainDb: 25 })).toThrow()
  })

  it('combines the take gain with the dubbing master in the export mix', () => {
    const timeline: AudioTimeline = {
      requiredDialogueIds: ['line-1'],
      missingDialogueIds: [],
      placements: [
        {
          dialogueId: 'line-1',
          takeId: 'take-1',
          fileRef: 'take.wav',
          startSeconds: 1,
          trimStartSeconds: 0,
          durationSeconds: 2,
          gainDb: 6,
        },
      ],
    }
    expect(buildFilterGraph(timeline, 5, false, 1, {}, 0.5)).toContain(
      'volume=0.9976,adelay=1000:all=1',
    )
  })
})
