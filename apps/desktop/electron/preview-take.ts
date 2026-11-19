import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PreviewTakeAudio, VoiceEffect } from '@studio/shared'
import { LibraryStore } from './library-store'
import { RoomClient } from './room-client'
import { effectTakeUrl } from './effect-preview'
import { recordingPath } from './recordings'

export async function localPreviewTakeAudio(
  store: LibraryStore,
  recordingRoot: string,
  effectRoot: string,
  projectId: string,
  dialogueId: string,
  takeId: string,
  effect?: VoiceEffect,
  gainDb = 0,
): Promise<PreviewTakeAudio> {
  const take = await store.getTake(takeId)
  if (
    !take ||
    !take.selected ||
    take.projectId !== projectId ||
    take.dialogueId !== dialogueId ||
    !(await store.getProject(projectId))
  )
    throw new Error('Selected recording not found')
  let path = recordingPath(recordingRoot, take)
  let mimeType = take.mimeType.split(';')[0].trim()
  if (effect || gainDb !== 0) {
    const url = await effectTakeUrl(
      store,
      recordingRoot,
      effectRoot,
      projectId,
      dialogueId,
      takeId,
      effect ?? {
        preset: 'original',
        pitch: 0,
        tone: 0,
        texture: 0,
        space: 0,
        echo: 0,
        mod: 0,
      },
      gainDb,
    )
    if (url.startsWith('studio-media://effect/')) {
      const filename = url.split('/').at(-1)
      if (!filename || !/^[0-9a-f-]{36}-[0-9a-f]{16}\.m4a$/.test(filename))
        throw new Error('Effect preview is unavailable')
      path = join(effectRoot, projectId, filename)
      mimeType = 'audio/mp4'
    }
  }
  return { bytes: new Uint8Array(await readFile(path)), mimeType }
}

export async function roomPreviewTakeAudio(
  client: RoomClient,
  projectId: string,
  dialogueId: string,
  takeId: string,
  effect?: VoiceEffect,
  gainDb = 0,
): Promise<PreviewTakeAudio> {
  const state = client.getInfo()?.state
  const take = state?.takes.find(
    (item) =>
      item.id === takeId &&
      item.projectId === projectId &&
      item.dialogueId === dialogueId &&
      item.selected,
  )
  if (!take || state?.project?.id !== projectId)
    throw new Error('Selected room recording not found')
  const path =
    effect || gainDb !== 0
      ? `/media/effect/${encodeURIComponent(dialogueId)}/${takeId}`
      : `/media/take/${takeId}`
  const url = new URL(client.mediaUrl(path))
  if (effect) url.searchParams.set('revision', JSON.stringify(effect))
  if (gainDb !== 0) url.searchParams.set('gainDb', String(gainDb))
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok) throw new Error('Room recording preview is unavailable')
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType:
      response.headers.get('content-type')?.split(';')[0] ||
      take.mimeType.split(';')[0].trim(),
  }
}
