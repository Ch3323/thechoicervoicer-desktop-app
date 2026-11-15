import { describe, expect, it } from 'vitest'
import {
  buildAudioTimeline,
  parseDubPack,
  type DubbingProject,
  type RecordingTake,
} from '@studio/shared'

describe('absolute-time recording timeline', () => {
  const pack = parseDubPack({
    id: 'pack-1',
    source: { kind: 'folder', location: 'C:/Scene' },
    folderName: 'Scene',
    files: [
      { path: 'dub_video.ogv' },
      { path: '01_A.wav' },
      {
        path: '01_A.ini',
        text: '[data]\ndub_timestamps=[0.1, 1.1]\ndub_characters=["A"]',
      },
      { path: '02_B.wav' },
      {
        path: '02_B.ini',
        text: '[data]\ndub_timestamps=[1.0]\ndub_characters=["B"]',
      },
    ],
  })
  const project: DubbingProject = {
    id: '00000000-0000-4000-8000-000000000001',
    packId: pack.id,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    enabledCharacterIds: pack.characters.map((character) => character.id),
  }
  const makeTake = (
    dialogueId: string,
    offsetSeconds: number,
    id: string,
  ): RecordingTake => ({
    id,
    projectId: project.id,
    dialogueId,
    fileRef: `${id}.wav`,
    mimeType: 'audio/wav',
    durationSeconds: 0.5,
    offsetSeconds,
    createdAt: '2026-01-01T00:00:00.000Z',
    selected: true,
  })

  it('places overlapping takes at each dialogue absolute timestamp without drift', () => {
    const [first, second, third] = pack.dialogues
    const takes = [
      makeTake(first.id, -0.25, '00000000-0000-4000-8000-000000000011'),
      makeTake(second.id, 0.1, '00000000-0000-4000-8000-000000000012'),
      makeTake(third.id, 0, '00000000-0000-4000-8000-000000000013'),
    ]
    const timeline = buildAudioTimeline(pack, project, takes)
    expect(timeline.missingDialogueIds).toEqual([])
    expect(
      timeline.placements.map((placement) => placement.startSeconds),
    ).toEqual([0, 1.1, 1.1])
    expect(timeline.placements[0].trimStartSeconds).toBeCloseTo(0.15)
    expect(timeline.placements[1].trimStartSeconds).toBe(0)
  })

  it('only requires lines assigned to enabled roles', () => {
    const onlyA = {
      ...project,
      enabledCharacterIds: [
        pack.characters.find((character) => character.name === 'A')!.id,
      ],
    }
    const timeline = buildAudioTimeline(pack, onlyA, [])
    expect(timeline.requiredDialogueIds).toHaveLength(2)
    expect(timeline.missingDialogueIds).toHaveLength(2)
  })

  it('includes selected recordings from unselected roles in the render timeline', () => {
    const onlyA = {
      ...project,
      enabledCharacterIds: [
        pack.characters.find((character) => character.name === 'A')!.id,
      ],
    }
    const otherRole = pack.dialogues.find((dialogue) =>
      dialogue.characterIds.includes(
        pack.characters.find((character) => character.name === 'B')!.id,
      ),
    )!
    const timeline = buildAudioTimeline(pack, onlyA, [
      makeTake(otherRole.id, 0.2, '00000000-0000-4000-8000-000000000031'),
    ])
    expect(timeline.requiredDialogueIds).toHaveLength(2)
    expect(timeline.missingDialogueIds).toHaveLength(2)
    expect(timeline.placements).toMatchObject([
      { dialogueId: otherRole.id, startSeconds: 1.2 },
    ])
  })

  it('rejects conflicting selected takes for one dialogue', () => {
    const dialogueId = pack.dialogues[0].id
    const takes = [
      makeTake(dialogueId, 0, '00000000-0000-4000-8000-000000000021'),
      makeTake(dialogueId, 0.1, '00000000-0000-4000-8000-000000000022'),
    ]
    expect(() => buildAudioTimeline(pack, project, takes)).toThrow(
      'Multiple selected takes',
    )
  })
})
