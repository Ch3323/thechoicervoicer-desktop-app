import { z } from 'zod'

const assetPath = z
  .string()
  .min(1)
  .regex(/^[^/\\]+$/, 'Asset path must be a filename')

export const CharacterSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  inferred: z.boolean(),
})

export const DialogueSchema = z.object({
  id: z.string().min(1),
  sourceRef: assetPath,
  metadataRef: assetPath.optional(),
  occurrenceIndex: z.number().int().nonnegative(),
  timestampSeconds: z.number().finite().nonnegative(),
  caption: z.string().optional(),
  characterIds: z.array(z.string().min(1)).min(1),
  imageRef: assetPath.optional(),
})

export const DubPackSchema = z
  .object({
    id: z.string().min(1),
    source: z.object({
      kind: z.enum(['folder', 'zip']),
      location: z.string().min(1),
    }),
    metadata: z.object({
      title: z.string().min(1),
      subtitle: z.string().optional(),
      authors: z.array(z.string()),
      readme: z.string().optional(),
    }),
    videoRef: assetPath,
    backingTrackRef: assetPath.optional(),
    iconRef: assetPath.optional(),
    characters: z.array(CharacterSchema),
    dialogues: z.array(DialogueSchema).min(1),
    warnings: z.array(z.string()),
  })
  .superRefine((pack, context) => {
    const characterIds = new Set(
      pack.characters.map((character) => character.id),
    )
    const dialogueIds = new Set<string>()
    for (const dialogue of pack.dialogues) {
      if (dialogueIds.has(dialogue.id))
        context.addIssue({
          code: 'custom',
          message: `Duplicate dialogue ID: ${dialogue.id}`,
        })
      dialogueIds.add(dialogue.id)
      if (dialogue.characterIds.some((id) => !characterIds.has(id))) {
        context.addIssue({
          code: 'custom',
          message: `Dialogue ${dialogue.id} references an unknown character`,
        })
      }
    }
  })

export const VoiceEffectSchema = z.object({
  preset: z.enum([
    'original',
    'deep',
    'cartoon',
    'robot',
    'radio',
    'echo',
    'hall',
    'cave',
    'megaphone',
    'alien',
    'monster',
    'chorus',
    'underwater',
    'custom',
  ]),
  pitch: z.number().finite().min(-12).max(12),
  tone: z.number().finite().min(-100).max(100),
  texture: z.number().finite().min(0).max(100),
  space: z.number().finite().min(0).max(100),
  echo: z.number().finite().min(0).max(100),
  mod: z.number().finite().min(0).max(100),
  basePreset: z
    .enum([
      'original',
      'deep',
      'cartoon',
      'robot',
      'radio',
      'echo',
      'hall',
      'cave',
      'megaphone',
      'alien',
      'monster',
      'chorus',
      'underwater',
    ])
    .optional(),
})

export const DubbingProjectSchema = z.object({
  id: z.string().min(1),
  packId: z.string().min(1),
  session: z.enum(['single', 'multiplayer']).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  enabledCharacterIds: z.array(z.string()),
  lastExportPath: z.string().optional(),
  voiceEffects: z.record(z.string(), VoiceEffectSchema).optional(),
})

export const RecordingTakeSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  dialogueId: z.string().min(1),
  fileRef: z.string().regex(/^[0-9a-f-]{36}\.(webm|ogg|m4a|wav)$/),
  mimeType: z.string().min(1),
  durationSeconds: z.number().finite().nonnegative(),
  offsetSeconds: z.number().finite().min(-3600).max(3600),
  createdAt: z.string().datetime(),
  selected: z.boolean(),
})

export type Character = z.infer<typeof CharacterSchema>
export type Dialogue = z.infer<typeof DialogueSchema>
export type DubPack = z.infer<typeof DubPackSchema>
export type DubbingProject = z.infer<typeof DubbingProjectSchema>
export type VoiceEffect = NonNullable<DubbingProject['voiceEffects']>[string]
export type RecordingTake = z.infer<typeof RecordingTakeSchema>

export interface ExportOptions {
  useBackingTrack: boolean
  requireComplete: boolean
  backingVolume?: number
  dubbingVolume?: number
  fastMode?: boolean
}

export interface ExportProgress {
  projectId: string
  percent: number
  message: string
}

export interface ExportResult {
  outputPath: string
  destination?: 'local' | 'drive'
  backingTrackUsed: boolean
  warnings: string[]
}
