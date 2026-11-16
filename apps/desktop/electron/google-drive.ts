import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import {
  readFile,
  rename,
  rm,
  stat,
  writeFile,
  mkdir,
  open,
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { safeStorage, shell } from 'electron'
import { z } from 'zod'

const clientIdSchema = z
  .string()
  .trim()
  .regex(/^[\w.-]+\.apps\.googleusercontent\.com$/)
const folderIdSchema = z
  .string()
  .trim()
  .regex(/^[\w-]{10,200}$/)
const settingsSchema = z.object({
  clientId: clientIdSchema,
  folderId: folderIdSchema,
  refreshToken: z.string().min(1),
})
type Settings = z.infer<typeof settingsSchema>
export type DriveStatus = {
  connected: boolean
  folderId?: string
  clientId?: string
}

export function parseDriveFolder(value: string): string {
  const input = value.trim()
  if (folderIdSchema.safeParse(input).success) return input
  const url = new URL(input)
  if (url.hostname !== 'drive.google.com' || url.protocol !== 'https:')
    throw new Error('Enter a Google Drive folder link or ID')
  const match = /^\/drive\/(?:u\/\d+\/)?folders\/([^/]+)\/?$/.exec(url.pathname)
  return folderIdSchema.parse(match?.[1])
}

export class GoogleDrive {
  private readonly path: string
  constructor(userData: string) {
    this.path = join(userData, 'google-drive.json')
  }

  private async read(): Promise<Settings | null> {
    try {
      if (!safeStorage.isEncryptionAvailable())
        throw new Error('Secure credential storage is unavailable')
      const encrypted = await readFile(this.path)
      return settingsSchema.parse(
        JSON.parse(safeStorage.decryptString(encrypted)),
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  async status(): Promise<DriveStatus> {
    const settings = await this.read()
    return settings
      ? {
          connected: true,
          folderId: settings.folderId,
          clientId: settings.clientId,
        }
      : { connected: false }
  }

  async disconnect(): Promise<void> {
    await rm(this.path, { force: true })
  }

  async connect(rawClientId: string, rawFolder: string): Promise<DriveStatus> {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error('Secure credential storage is unavailable')
    const clientId = clientIdSchema.parse(rawClientId)
    const folderId = parseDriveFolder(rawFolder)
    const verifier = randomBytes(32).toString('base64url')
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const state = randomUUID()
    const code = await new Promise<{ code: string; redirectUri: string }>(
      (resolve, reject) => {
        const server = createServer((request, response) => {
          const url = new URL(request.url ?? '/', 'http://127.0.0.1')
          if (
            url.pathname !== '/oauth/callback' ||
            url.searchParams.get('state') !== state
          ) {
            response.writeHead(400).end('Invalid authorization response')
            return
          }
          const returnedCode = url.searchParams.get('code')
          const error = url.searchParams.get('error')
          response
            .writeHead(returnedCode ? 200 : 400, {
              'Content-Type': 'text/plain; charset=utf-8',
            })
            .end(
              returnedCode
                ? 'Google Drive connected. Return to the app.'
                : 'Google Drive connection was canceled.',
            )
          if (returnedCode)
            finish(() => resolve({ code: returnedCode, redirectUri: redirect }))
          else
            finish(() =>
              reject(
                new Error(error ?? 'Google Drive connection was canceled'),
              ),
            )
        })
        let redirect = ''
        const timer = setTimeout(
          () =>
            finish(() => reject(new Error('Google Drive sign-in timed out'))),
          180_000,
        )
        const finish = (done: () => void) => {
          clearTimeout(timer)
          server.close()
          done()
        }
        server.once('error', reject)
        server.listen(0, '127.0.0.1', () => {
          const address = server.address()
          if (!address || typeof address === 'string')
            return finish(() =>
              reject(new Error('Unable to start Google sign-in')),
            )
          redirect = `http://127.0.0.1:${address.port}/oauth/callback`
          const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
          url.search = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirect,
            response_type: 'code',
            scope: 'https://www.googleapis.com/auth/drive',
            access_type: 'offline',
            prompt: 'consent',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            state,
          }).toString()
          void shell
            .openExternal(url.toString())
            .catch((error) => finish(() => reject(error)))
        })
      },
    )
    const token = await this.tokenRequest({
      client_id: clientId,
      code: code.code,
      code_verifier: verifier,
      redirect_uri: code.redirectUri,
      grant_type: 'authorization_code',
    })
    if (!token.refresh_token)
      throw new Error(
        'Google did not provide offline access; try connecting again',
      )
    const accessToken = z.string().parse(token.access_token)
    const folder = await this.driveJson(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?fields=id,name,mimeType&supportsAllDrives=true`,
      accessToken,
    )
    if (folder.mimeType !== 'application/vnd.google-apps.folder')
      throw new Error(
        'The selected Drive item is not a folder or is not accessible to this app',
      )
    const data = safeStorage.encryptString(
      JSON.stringify({ clientId, folderId, refreshToken: token.refresh_token }),
    )
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, data)
      await rename(temporary, this.path)
    } finally {
      await rm(temporary, { force: true })
    }
    return { connected: true, clientId, folderId }
  }

  private async tokenRequest(
    values: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(values),
    })
    const data = (await response.json()) as Record<string, unknown>
    if (!response.ok)
      throw new Error(
        `Google authorization failed: ${String(data.error ?? response.status)}`,
      )
    return data
  }

  private async driveJson(
    url: string,
    token: string,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok)
      throw new Error(`Google Drive request failed (${response.status})`)
    return (await response.json()) as Record<string, unknown>
  }

  async upload(
    path: string,
    name: string,
    signal?: AbortSignal,
    progress?: (percent: number) => void,
  ): Promise<string> {
    const settings = await this.read()
    if (!settings) throw new Error('Connect Google Drive in Settings first')
    const token = await this.tokenRequest({
      client_id: settings.clientId,
      refresh_token: settings.refreshToken,
      grant_type: 'refresh_token',
    })
    const accessToken = z.string().parse(token.access_token)
    const size = (await stat(path)).size
    const start = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id',
      {
        method: 'POST',
        signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(size),
        },
        body: JSON.stringify({
          name,
          mimeType: 'video/mp4',
          parents: [settings.folderId],
        }),
      },
    )
    if (!start.ok)
      throw new Error(`Google Drive upload could not start (${start.status})`)
    const location = start.headers.get('location')
    if (!location || new URL(location).origin !== 'https://www.googleapis.com')
      throw new Error('Google Drive returned an invalid upload address')
    const file = await open(path, 'r')
    try {
      let offset = 0
      while (offset < size) {
        signal?.throwIfAborted()
        const length = Math.min(8 * 1024 * 1024, size - offset)
        const buffer = Buffer.allocUnsafe(length)
        const { bytesRead } = await file.read(buffer, 0, length, offset)
        if (bytesRead !== length)
          throw new Error('Export file changed during upload')
        const response = await fetch(location, {
          method: 'PUT',
          signal,
          headers: {
            'Content-Length': String(length),
            'Content-Range': `bytes ${offset}-${offset + length - 1}/${size}`,
            'Content-Type': 'video/mp4',
          },
          body: buffer,
        })
        if (response.status !== 308 && !response.ok)
          throw new Error(`Google Drive upload failed (${response.status})`)
        if (response.ok) {
          const result = (await response.json()) as Record<string, unknown>
          const id = z.string().parse(result.id)
          progress?.(100)
          return `https://drive.google.com/file/d/${id}/view`
        }
        const range = response.headers.get('range')
        const match = /^bytes=0-(\d+)$/.exec(range ?? '')
        if (!match) throw new Error('Google Drive did not report the upload offset')
        const acknowledged = Number(match[1]) + 1
        if (acknowledged <= offset || acknowledged > offset + length)
          throw new Error('Google Drive returned an invalid upload offset')
        offset = acknowledged
        progress?.(Math.round((offset / size) * 100))
      }
      throw new Error('Google Drive did not confirm the upload')
    } finally {
      await file.close()
    }
  }
}
