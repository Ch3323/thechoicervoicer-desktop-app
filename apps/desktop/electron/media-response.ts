import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname } from 'node:path'
import { Readable } from 'node:stream'

const mimeTypes: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
}

function requestedBytes(
  range: string,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!match || (!match[1] && !match[2])) return null
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]))
  const end =
    match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start >= size ||
    end < start
  )
    return null
  return { start, end }
}

/** Serve a validated local asset with byte ranges so Chromium can seek in large MP4 files. */
export async function mediaFileResponse(
  request: Request,
  path: string,
  allowAudioProcessing = false,
): Promise<Response> {
  const file = await stat(path)
  if (!file.isFile()) throw new Error('Media asset is not a file')
  const headers = new Headers({
    'Accept-Ranges': 'bytes',
    'Content-Type':
      mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  })
  if (allowAudioProcessing) headers.set('Access-Control-Allow-Origin', '*')
  const rangeHeader = request.headers.get('range')
  const range = rangeHeader ? requestedBytes(rangeHeader, file.size) : null
  if (rangeHeader && !range) {
    headers.set('Content-Range', `bytes */${file.size}`)
    return new Response(null, { status: 416, headers })
  }
  const start = range?.start ?? 0
  const end = range?.end ?? file.size - 1
  headers.set('Content-Length', String(Math.max(0, end - start + 1)))
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`)
  if (request.method === 'HEAD' || file.size === 0)
    return new Response(null, { status: range ? 206 : 200, headers })
  const body = Readable.toWeb(
    createReadStream(path, { start, end }),
  ) as ReadableStream
  return new Response(body, { status: range ? 206 : 200, headers })
}
