import { z } from 'zod'
import type {
  DubPack,
  DubbingProject,
  ExportProgress,
  RecordingTake,
} from './models'

export const RoomCodeSchema = z.string().regex(/^[A-Z2-9]{6}$/)
export const DisplayNameSchema = z.string().trim().min(1).max(32)
export const RoomPortSchema = z.number().int().min(1024).max(65535)

export interface RoomPlayer {
  id: string
  displayName: string
  connected: boolean
  isHost: boolean
  packReady?: boolean
}

export interface RoomState {
  code: string
  hostPlayerId: string
  players: RoomPlayer[]
  assignments: Record<string, string>
  dialogueOwners: Record<string, string>
  pack: DubPack | null
  packFingerprint?: string
  project: DubbingProject | null
  takes: RecordingTake[]
  exportProgress: ExportProgress | null
  exportComplete: boolean
  readyPlayerIds: string[]
  started: boolean
}

export interface DiscoveredRoom {
  address: string
  code: string
  title: string
  players: number
}

export const RoomJoinInfoSchema = z.object({
  code: RoomCodeSchema,
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  title: z.string().min(1),
  started: z.boolean(),
  matchingPacks: z
    .array(z.object({ id: z.string().min(1), title: z.string() }))
    .default([]),
  roles: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      clips: z.number().int().nonnegative(),
      available: z.boolean(),
    }),
  ),
})
export type RoomJoinInfo = z.infer<typeof RoomJoinInfoSchema>

/** Keep Host dialogue IDs while reading source media from the local pack. */
export function roomPackForLocalAssets(
  hostPack: DubPack,
  localPack: DubPack,
): DubPack {
  const hostDialogueIds = new Set(hostPack.dialogues.map((item) => item.id))
  const dialogues = localPack.dialogues.map((dialogue) => ({
    ...dialogue,
    id: `${hostPack.id}${dialogue.id.slice(localPack.id.length)}`,
  }))
  if (
    dialogues.length !== hostDialogueIds.size ||
    dialogues.some((dialogue) => !hostDialogueIds.has(dialogue.id))
  )
    throw new Error('Local Dub Pack does not match the room')
  return {
    ...localPack,
    dialogues,
  }
}

export function canRecordDialogue(
  state: RoomState,
  playerId: string,
  dialogueId: string,
): boolean {
  const dialogue = state.pack?.dialogues.find((item) => item.id === dialogueId)
  if (!dialogue || !state.project) return false
  if (!dialogue.characterIds.some((id) => state.assignments[id] === playerId))
    return false
  const owner = state.dialogueOwners[dialogueId]
  return !owner || owner === playerId
}

export function roomProjectForPlayer(
  state: RoomState,
  playerId: string,
): DubbingProject | null {
  if (!state.project) return null
  return {
    ...state.project,
    enabledCharacterIds: Object.entries(state.assignments)
      .filter(([, owner]) => owner === playerId)
      .map(([characterId]) => characterId),
  }
}
