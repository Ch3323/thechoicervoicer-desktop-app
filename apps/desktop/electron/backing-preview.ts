import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DubPack } from '@studio/shared'
import { packAssetFolder } from './pack-files'
import { convertAudioToM4a } from './preview-proxy'

const activePreviews = new Map<string, Promise<string>>()

export function ensureBackingPreview(
  pack: DubPack,
  packStorage: string,
  previewStorage: string,
): Promise<string> {
  const existing = activePreviews.get(pack.id)
  if (existing) return existing
  const pending = (async () => {
    if (!pack.backingTrackRef) throw new Error('This pack has no backing track')
    const source = join(
      packAssetFolder(pack, packStorage),
      pack.backingTrackRef,
    )
    const output = join(previewStorage, `${pack.id}-backing.m4a`)
    const sourceFile = await stat(source)
    try {
      const cached = await stat(output)
      if (cached.isFile() && cached.mtimeMs >= sourceFile.mtimeMs) return output
    } catch {
      // A private preview has not been generated yet.
    }
    await mkdir(previewStorage, { recursive: true })
    const temporary = `${output}.${randomUUID()}.tmp.m4a`
    try {
      await convertAudioToM4a(source, temporary)
      await rm(output, { force: true })
      await rename(temporary, output)
      return output
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  })().finally(() => activePreviews.delete(pack.id))
  activePreviews.set(pack.id, pending)
  return pending
}

export async function backingPreviewBytes(
  pack: DubPack,
  packStorage: string,
  previewStorage: string,
): Promise<Uint8Array> {
  return new Uint8Array(
    await readFile(await ensureBackingPreview(pack, packStorage, previewStorage)),
  )
}
