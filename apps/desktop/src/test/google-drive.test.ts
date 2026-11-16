import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
  shell: { openExternal: vi.fn() },
}))

import { GoogleDrive, parseDriveFolder } from '../../electron/google-drive'

const roots: string[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

describe('Google Drive destination', () => {
  it('accepts only Drive folder links or IDs', () => {
    expect(
      parseDriveFolder('https://drive.google.com/drive/folders/abcdefghij123'),
    ).toBe('abcdefghij123')
    expect(parseDriveFolder('abcdefghij123')).toBe('abcdefghij123')
    expect(() =>
      parseDriveFolder('https://evil.example/drive/folders/abcdefghij123'),
    ).toThrow()
    expect(() =>
      parseDriveFolder('https://drive.google.com/file/d/abcdefghij123/view'),
    ).toThrow()
  })

  it('uploads the rendered MP4 to the configured folder in chunks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'studio-drive-test-'))
    roots.push(root)
    await writeFile(
      join(root, 'google-drive.json'),
      Buffer.from(
        JSON.stringify({
          clientId: 'client.apps.googleusercontent.com',
          folderId: 'abcdefghij123',
          refreshToken: 'refresh',
        }),
      ),
    )
    const video = join(root, 'render.mp4')
    await writeFile(video, Buffer.from('video bytes'))
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: 'access' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { location: 'https://www.googleapis.com/upload/session' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'uploaded-id' }), { status: 200 }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const url = await new GoogleDrive(root).upload(video, 'Dub.mp4')

    expect(url).toBe('https://drive.google.com/file/d/uploaded-id/view')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      name: 'Dub.mp4',
      mimeType: 'video/mp4',
      parents: ['abcdefghij123'],
    })
    expect(fetchMock.mock.calls[2][1].headers['Content-Range']).toBe(
      'bytes 0-10/11',
    )
  })
})
