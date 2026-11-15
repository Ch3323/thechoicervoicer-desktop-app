import { describe, expect, it } from 'vitest'
import { dialoguePreviewRange, type Dialogue } from '@studio/shared'

const dialogue: Dialogue = {
  id: 'line:0',
  sourceRef: 'line.wav',
  occurrenceIndex: 0,
  timestampSeconds: 12.5,
  characterIds: ['speaker'],
}

describe('selected dialogue preview', () => {
  it('starts at the dialogue timestamp and ends after its source sample', () => {
    expect(dialoguePreviewRange(dialogue, 60, 2.25)).toEqual({
      startSeconds: 12.5,
      endSeconds: 15.25,
    })
  })

  it('uses a bounded fallback and never passes the video end', () => {
    expect(dialoguePreviewRange(dialogue, 60)).toEqual({
      startSeconds: 12.5,
      endSeconds: 18.5,
    })
    expect(dialoguePreviewRange(dialogue, 14, 3)).toEqual({
      startSeconds: 12.5,
      endSeconds: 14,
    })
    expect(dialoguePreviewRange(dialogue, 60, Number.NaN).endSeconds).toBe(18.5)
  })
})
