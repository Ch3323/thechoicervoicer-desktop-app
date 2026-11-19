import { stat, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { protocol } from 'electron'
import type { DubPack } from '@studio/shared'
import { LibraryStore } from './library-store'
import { packAssetFolder } from './pack-files'
import { convertVideoToMp4 } from './preview-proxy'
import { recordingPath } from './recordings'
import { mediaFileResponse } from './media-response'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'studio-media',
    privileges: {
      standard: true,
      secure: true,
      stream: true,
      supportFetchAPI: true,
    },
  },
])

function assetRefs(pack: DubPack): Set<string> {
  return new Set(
    [
      pack.videoRef,
      pack.backingTrackRef,
      pack.iconRef,
      ...pack.dialogues.flatMap((dialogue) => [
        dialogue.sourceRef,
        dialogue.imageRef,
      ]),
    ].filter((ref): ref is string => Boolean(ref)),
  )
}

function mediaUrl(packId: string, asset: string): string {
  return `studio-media://${packId}/${encodeURIComponent(asset)}`
}

export function registerMediaProtocol(
  store: LibraryStore,
  storageRoot: string,
  previewRoot: string,
  recordingRoot: string,
  dubPreviewRoot: string,
  effectRoot: string,
  roomMediaUrl?: (path: string) => string,
  roomPreviewRoot?: string,
): void {
  protocol.handle('studio-media', async (request) => {
    const url = new URL(request.url)
    if (url.hostname === 'room-local' && roomPreviewRoot) {
      const match = /^\/([0-9a-f-]{36})\.mp4$/.exec(url.pathname)
      if (!match) return new Response('Preview not found', { status: 404 })
      try {
        return await mediaFileResponse(
          request,
          join(roomPreviewRoot, `${match[1]}.mp4`),
        )
      } catch {
        return new Response('Preview unavailable', { status: 404 })
      }
    }
    if (url.hostname === 'room') {
      const match =
        /^\/(preview|backing|asset\/[^/]+|take\/[0-9a-f-]{36}|effect\/[^/]+\/[0-9a-f-]{36})$/.exec(
          url.pathname,
        )
      if (!match || !roomMediaUrl)
        return new Response('Room media unavailable', { status: 404 })
      try {
        const path =
          match[1] === 'preview' ? '/media/preview' : `/media/${match[1]}`
        const remoteUrl = new URL(roomMediaUrl(path))
        if (match[1].startsWith('effect/') && url.searchParams.has('revision'))
          remoteUrl.searchParams.set(
            'revision',
            url.searchParams.get('revision')!,
          )
        if (match[1].startsWith('effect/') && url.searchParams.has('gainDb'))
          remoteUrl.searchParams.set('gainDb', url.searchParams.get('gainDb')!)
        return await fetch(remoteUrl, {
          headers: request.headers.get('range')
            ? { Range: request.headers.get('range')! }
            : {},
        })
      } catch {
        return new Response('Room media unavailable', { status: 404 })
      }
    }
    if (url.hostname === 'effect') {
      const match =
        /^\/([0-9a-f-]{36})\/([0-9a-f-]{36})-([0-9a-f]{16})\.m4a$/.exec(
          url.pathname,
        )
      if (!match)
        return new Response('Effect preview not found', { status: 404 })
      const take = await store.getTake(match[2])
      if (!take || take.projectId !== match[1])
        return new Response('Effect preview not found', { status: 404 })
      try {
        return await mediaFileResponse(
          request,
          join(effectRoot, match[1], `${match[2]}-${match[3]}.m4a`),
        )
      } catch {
        return new Response('Effect preview unavailable', { status: 404 })
      }
    }
    if (url.hostname === 'dub') {
      const match = /^\/([0-9a-f-]{36})\.mp4$/.exec(url.pathname)
      if (!match || !(await store.getProject(match[1])))
        return new Response('Dub preview not found', { status: 404 })
      try {
        return await mediaFileResponse(
          request,
          join(dubPreviewRoot, `${match[1]}.mp4`),
        )
      } catch {
        return new Response('Dub preview unavailable', { status: 404 })
      }
    }
    if (url.hostname === 'take') {
      const takeId = decodeURIComponent(url.pathname.slice(1))
      if (!/^[0-9a-f-]{36}$/.test(takeId))
        return new Response('Recording not found', { status: 404 })
      const take = await store.getTake(takeId)
      if (!take) return new Response('Recording not found', { status: 404 })
      try {
        const path = recordingPath(recordingRoot, take)
        return await mediaFileResponse(request, path)
      } catch {
        return new Response('Recording unavailable', { status: 404 })
      }
    }
    const pack = await store.getPack(url.hostname)
    if (!pack) return new Response('Pack not found', { status: 404 })
    const asset = decodeURIComponent(url.pathname.slice(1))
    const preview = asset === 'preview.mp4'
    if (!preview && !assetRefs(pack).has(asset))
      return new Response('Asset not found', { status: 404 })
    const path = preview
      ? join(previewRoot, `${pack.id}.mp4`)
      : join(packAssetFolder(pack, storageRoot), asset)
    try {
      return await mediaFileResponse(
        request,
        path,
        asset === pack.backingTrackRef,
      )
    } catch {
      return new Response('Asset is unavailable', { status: 404 })
    }
  })
}

export function getTakeUrl(takeId: string): string {
  return `studio-media://take/${takeId}`
}

export function getAssetUrl(pack: DubPack, asset: string): string {
  if (!assetRefs(pack).has(asset))
    throw new Error('Asset is not part of this pack')
  return mediaUrl(pack.id, asset)
}

const activePreviews = new Map<string, Promise<string>>()

export function ensurePreview(
  pack: DubPack,
  storageRoot: string,
  previewRoot: string,
): Promise<string> {
  const existing = activePreviews.get(pack.id)
  if (existing) return existing
  const pending = createPreview(pack, storageRoot, previewRoot).finally(() =>
    activePreviews.delete(pack.id),
  )
  activePreviews.set(pack.id, pending)
  return pending
}

async function createPreview(
  pack: DubPack,
  storageRoot: string,
  previewRoot: string,
): Promise<string> {
  const source = join(packAssetFolder(pack, storageRoot), pack.videoRef)
  const output = join(previewRoot, `${pack.id}.mp4`)
  const sourceStat = await stat(source)
  try {
    const outputStat = await stat(output)
    if (outputStat.mtimeMs >= sourceStat.mtimeMs)
      return mediaUrl(pack.id, 'preview.mp4')
  } catch {
    /* no cached proxy */
  }

  await mkdir(previewRoot, { recursive: true })
  const temp = `${output}.tmp.mp4`
  try {
    await convertVideoToMp4(source, temp)
    await rm(output, { force: true })
    await rename(temp, output)
    return mediaUrl(pack.id, 'preview.mp4')
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}
