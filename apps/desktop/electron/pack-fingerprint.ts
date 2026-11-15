import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import type { DubPack } from '@studio/shared'
import { packAssetFolder } from './pack-files'
import { join } from 'node:path'

/** Identifies the parsed pack and every media asset used by a room render. */
export async function packFingerprint(
  pack: DubPack,
  storageRoot: string,
): Promise<string> {
  const hash = createHash('sha256')
  hash.update(
    JSON.stringify({
      videoRef: pack.videoRef,
      backingTrackRef: pack.backingTrackRef,
      characters: pack.characters,
      dialogues: pack.dialogues.map((dialogue) => ({
        ...dialogue,
        id: dialogue.id.startsWith(`${pack.id}:`)
          ? dialogue.id.slice(pack.id.length + 1)
          : dialogue.id,
      })),
    }),
  )
  const refs = [
    ...new Set(
      [
        pack.videoRef,
        pack.backingTrackRef,
        pack.iconRef,
        ...pack.dialogues.map((dialogue) => dialogue.sourceRef),
        ...pack.dialogues.map((dialogue) => dialogue.imageRef),
      ].filter((ref): ref is string => Boolean(ref)),
    ),
  ].sort()
  for (const ref of refs) {
    hash.update(ref)
    hash.update('\0')
    for await (const chunk of createReadStream(
      join(packAssetFolder(pack, storageRoot), ref),
    ))
      hash.update(chunk)
  }
  return hash.digest('hex')
}
