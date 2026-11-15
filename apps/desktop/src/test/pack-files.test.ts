// @vitest-environment node
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync, strToU8 } from 'fflate'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ImportProgress } from '@studio/shared'
import { importFolder, importZip } from '../../electron/pack-files'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'studio-pack-test-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('folder and ZIP adapters', () => {
  it('imports a folder without modifying original files', async () => {
    const folder = join(root, 'Sample')
    await mkdir(folder)
    await writeFile(join(folder, 'dub_video.ogv'), 'video')
    await writeFile(join(folder, '01_Test.wav'), 'audio')
    const metadata = '[data]\ndub_timestamps=[3.5]\ndub_characters=["Speaker"]'
    await writeFile(join(folder, '01_Test.ini'), metadata)
    const pack = await importFolder(folder)
    expect(pack.dialogues[0].timestampSeconds).toBe(3.5)
    expect(pack.source.kind).toBe('folder')
    expect(await readFile(join(folder, '01_Test.ini'), 'utf8')).toBe(metadata)
  })

  it('imports a wrapped ZIP and rejects traversal entries', async () => {
    const archive = join(root, 'sample.zip')
    await writeFile(
      archive,
      zipSync({
        'My Pack/dub_video.ogv': strToU8('video'),
        'My Pack/01_Test.wav': strToU8('audio'),
        'My Pack/_backing_track.m4a': strToU8('backing'),
        'My Pack/01_Test.txt': strToU8(
          '[data]\ndub_timestamps=[4, 7]\ndub_characters=["Voice"]',
        ),
      }),
    )
    const progress: ImportProgress[] = []
    const pack = await importZip(archive, join(root, 'storage'), (update) =>
      progress.push(update),
    )
    expect(progress[0]).toMatchObject({
      phase: 'extracting',
      completedBytes: 0,
    })
    expect(progress.at(-1)?.completedBytes).toBe(progress.at(-1)?.totalBytes)
    expect(pack.dialogues.map((dialogue) => dialogue.timestampSeconds)).toEqual(
      [4, 7],
    )
    expect(pack.source.kind).toBe('zip')
    expect(pack.backingTrackRef).toBe('_backing_track.m4a')
    expect(
      await readFile(
        join(root, 'storage', pack.id, '_backing_track.m4a'),
        'utf8',
      ),
    ).toBe('backing')
    expect(
      await readFile(join(root, 'storage', pack.id, '01_Test.txt'), 'utf8'),
    ).toContain('dub_timestamps')

    const unsafe = join(root, 'unsafe.zip')
    await writeFile(
      unsafe,
      zipSync({
        '../outside.txt': strToU8('bad'),
        'dub_video.ogv': strToU8('video'),
      }),
    )
    await expect(importZip(unsafe, join(root, 'storage'))).rejects.toThrow()
  })
})
