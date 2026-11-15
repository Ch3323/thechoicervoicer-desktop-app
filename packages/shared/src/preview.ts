import type { Dialogue } from './models'

export interface DialoguePreviewRange {
  startSeconds: number
  endSeconds: number
}

/** Dub Pack metadata gives a clip start, but no end. Use its source sample length when available. */
export function dialoguePreviewRange(
  dialogue: Dialogue,
  videoDurationSeconds: number,
  sampleDurationSeconds?: number,
): DialoguePreviewRange {
  const startSeconds = dialogue.timestampSeconds
  const sampleLength =
    sampleDurationSeconds !== undefined &&
    Number.isFinite(sampleDurationSeconds) &&
    sampleDurationSeconds > 0
      ? sampleDurationSeconds + 0.5
      : 6
  const endSeconds =
    Number.isFinite(videoDurationSeconds) && videoDurationSeconds > 0
      ? Math.min(startSeconds + sampleLength, videoDurationSeconds)
      : startSeconds + sampleLength
  return { startSeconds, endSeconds: Math.max(startSeconds, endSeconds) }
}
