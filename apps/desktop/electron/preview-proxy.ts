import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

export function ffmpegExecutable(): string {
  if (!ffmpegPath)
    throw new Error('FFmpeg preview converter is unavailable on this platform')
  return ffmpegPath.replace('app.asar', 'app.asar.unpacked')
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolveRun, reject) => {
    const child = spawn(ffmpegExecutable(), args, { windowsHide: true })
    let errorText = ''
    child.stderr.on('data', (chunk: Buffer) => {
      errorText = (errorText + chunk.toString()).slice(-4000)
    })
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0
        ? resolveRun()
        : reject(new Error(errorText || `FFmpeg exited with code ${code}`)),
    )
  })
}

/** Creates a disposable browser-compatible preview. The OGV source is read only. */
export function convertOgvToMp4(source: string, output: string): Promise<void> {
  return runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    source,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '26',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-movflags',
    '+faststart',
    output,
  ])
}

/** Creates a disposable AAC backing track for browser playback. */
export function convertAudioToM4a(source: string, output: string): Promise<void> {
  return runFfmpeg([
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    source,
    '-map',
    '0:a:0',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-movflags',
    '+faststart',
    output,
  ])
}
