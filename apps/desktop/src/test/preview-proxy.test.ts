// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { convertOgvToMp4, ffmpegExecutable } from '../../electron/preview-proxy'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'studio-preview-test-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegExecutable(), args, { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(stderr)),
    )
  })
}

describe('OGV preview proxy', () => {
  it('converts Theora video to a playable MP4 without changing the source', async () => {
    const source = join(root, 'dub_video.ogv')
    const preview = join(root, 'preview.mp4')
    await ffmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=160x90:d=1',
      '-c:v',
      'libtheora',
      '-an',
      source,
    ])
    const original = await readFile(source)
    await convertOgvToMp4(source, preview)
    expect(await readFile(source)).toEqual(original)
    const output = await readFile(preview)
    expect(output.length).toBeGreaterThan(1000)
    expect(output.toString('ascii', 4, 8)).toBe('ftyp')
    await ffmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      preview,
      '-f',
      'null',
      '-',
    ])
  }, 30_000)
})
