// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mediaFileResponse } from '../../electron/media-response'

let folder: string
let path: string
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'studio-media-test-'))
  path = join(folder, 'preview.mp4')
  await writeFile(path, Buffer.from('0123456789'))
})
afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

describe('media byte-range delivery', () => {
  it('serves a seekable video segment with correct range headers', async () => {
    const response = await mediaFileResponse(
      new Request('studio-media://pack/preview.mp4', {
        headers: { Range: 'bytes=4-7' },
      }),
      path,
    )
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 4-7/10')
    expect(response.headers.get('Content-Length')).toBe('4')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('Content-Type')).toBe('video/mp4')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(await response.text()).toBe('4567')
  })

  it('allows browser audio processing only when requested for a backing asset', async () => {
    const response = await mediaFileResponse(
      new Request('studio-media://pack/_backing_track.ogg'),
      path,
      true,
    )
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('supports suffix ranges and rejects unsatisfiable ranges', async () => {
    const suffix = await mediaFileResponse(
      new Request('studio-media://pack/preview.mp4', {
        headers: { Range: 'bytes=-3' },
      }),
      path,
    )
    expect(await suffix.text()).toBe('789')
    const invalid = await mediaFileResponse(
      new Request('studio-media://pack/preview.mp4', {
        headers: { Range: 'bytes=20-' },
      }),
      path,
    )
    expect(invalid.status).toBe(416)
    expect(invalid.headers.get('Content-Range')).toBe('bytes */10')
  })
})
