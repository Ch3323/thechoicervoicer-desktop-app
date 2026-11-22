import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { DubPack } from '@studio/shared'
import { packAssetFolder } from './pack-files'
import { join } from 'node:path'

const MAX_CACHED_PACKS = 32
const cachedFingerprints = new Map<
  string,
  { metadata: string; fileVersions: string; fingerprint: string }
>()

async function readFileVersions(files: string[]): Promise<string> {
  const versions: string[] = []
  for (let offset = 0; offset < files.length; offset += 32) {
    const batch = await Promise.all(
      files.slice(offset, offset + 32).map(async (path) => {
        const file = await stat(path, { bigint: true })
        if (!file.isFile()) throw new Error('Pack asset is unavailable')
        return `${file.dev}:${file.ino}:${file.size}:${file.mtimeNs}:${file.ctimeNs}`
      }),
    )
    versions.push(...batch)
  }
  return versions.join('\n')
}

/** Identifies the parsed pack and every media asset used by a room render. */
export async function packFingerprint(
  pack: DubPack,
  storageRoot: string,
  // Room downloads are verified in staging before the folder is installed.
  assetFolder = packAssetFolder(pack, storageRoot),
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
  const cacheKey = packAssetFolder(pack, storageRoot)
  const metadata = hash.copy().update(JSON.stringify(refs)).digest('hex')
  const files = refs.map((ref) => join(assetFolder, ref))
  const fileVersions = await readFileVersions(files)
  const cached = cachedFingerprints.get(cacheKey)
  if (cached?.metadata === metadata && cached.fileVersions === fileVersions)
    return cached.fingerprint

  for (const [index, path] of files.entries()) {
    hash.update(refs[index])
    hash.update('\0')
    for await (const chunk of createReadStream(path, { highWaterMark: 512 * 1024 }))
      hash.update(chunk)
  }
  if ((await readFileVersions(files)) !== fileVersions)
    throw new Error('Pack assets changed during verification')

  const fingerprint = hash.digest('hex')
  cachedFingerprints.delete(cacheKey)
  if (cachedFingerprints.size >= MAX_CACHED_PACKS) {
    const oldest = cachedFingerprints.keys().next().value
    if (oldest !== undefined) cachedFingerprints.delete(oldest)
  }
  cachedFingerprints.set(cacheKey, { metadata, fileVersions, fingerprint })
  return fingerprint
}
