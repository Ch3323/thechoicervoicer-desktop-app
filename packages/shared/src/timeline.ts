import type { DubPack, DubbingProject, RecordingTake } from './models'
import { dialogueMatchesRoles } from './roles'

export interface AudioPlacement {
  dialogueId: string
  takeId: string
  fileRef: string
  /** Absolute position on the source video timeline. */
  startSeconds: number
  /** Audio trimmed when a negative offset moves a take before time zero. */
  trimStartSeconds: number
  /** Limits playback/export to the intended take length. */
  durationSeconds: number
  /** Per-take level in decibels, before the master dubbing level. */
  gainDb: number
}

export interface AudioTimeline {
  requiredDialogueIds: string[]
  missingDialogueIds: string[]
  placements: AudioPlacement[]
}

export function buildAudioTimeline(
  pack: DubPack,
  project: DubbingProject,
  takes: readonly RecordingTake[],
): AudioTimeline {
  if (pack.id !== project.packId)
    throw new Error('Project and pack do not match')
  const required = pack.dialogues.filter((dialogue) =>
    dialogueMatchesRoles(dialogue, project.enabledCharacterIds),
  )
  const requiredDialogueIds = required.map((dialogue) => dialogue.id)
  const requiredIds = new Set(requiredDialogueIds)
  const missingDialogueIds: string[] = []
  const placements: AudioPlacement[] = []

  // Role selection controls the completion target, not the final audio mix.
  for (const dialogue of pack.dialogues) {
    const selected = takes.filter(
      (take) =>
        take.projectId === project.id &&
        take.dialogueId === dialogue.id &&
        take.selected,
    )
    if (selected.length > 1)
      throw new Error(`Multiple selected takes for dialogue ${dialogue.id}`)
    const take = selected[0]
    if (!take) {
      if (requiredIds.has(dialogue.id)) missingDialogueIds.push(dialogue.id)
      continue
    }
    const absolute = dialogue.timestampSeconds + take.offsetSeconds
    placements.push({
      dialogueId: dialogue.id,
      takeId: take.id,
      fileRef: take.fileRef,
      startSeconds: Math.max(0, absolute),
      trimStartSeconds: Math.max(0, -absolute),
      durationSeconds: take.durationSeconds,
      gainDb: take.gainDb ?? 0,
    })
  }

  return { requiredDialogueIds, missingDialogueIds, placements }
}
