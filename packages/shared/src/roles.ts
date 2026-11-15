import type { Dialogue, DubbingProject } from './models'

export function selectRoles(
  project: DubbingProject,
  availableCharacterIds: readonly string[],
  requestedIds: readonly string[],
): DubbingProject {
  const available = new Set(availableCharacterIds)
  const unique = [...new Set(requestedIds)]
  if (unique.some((id) => !available.has(id))) {
    throw new Error('Role selection contains an unknown character')
  }
  return {
    ...project,
    enabledCharacterIds: unique,
    updatedAt: new Date().toISOString(),
  }
}

export function dialogueMatchesRoles(
  dialogue: Dialogue,
  enabledCharacterIds: readonly string[],
): boolean {
  return dialogue.characterIds.some((id) => enabledCharacterIds.includes(id))
}
