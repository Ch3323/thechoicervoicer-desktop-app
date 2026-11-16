import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  RECORDING_LEAD_IN_SECONDS,
  RECORDING_TAIL_SECONDS,
  waveformPeaks,
  type WaveformSnapshot,
} from '@studio/shared'
import { LibraryStore } from './library-store'
import { packAssetFolder } from './pack-files'
import { ffmpegExecutable } from './preview-proxy'
import { recordingPath } from './recordings'

const SAMPLE_RATE = 8000
const MAX_SECONDS = 60
const decodedCache = new Map<string, Promise<Float32Array>>()
const MAX_CACHED_CLIPS = 16

async function cachedAudio(path: string): Promise<Float32Array> {
  const file = await stat(path)
  const key = `${path}:${file.size}:${file.mtimeMs}`
  const existing = decodedCache.get(key)
  if (existing) {
    decodedCache.delete(key)
    decodedCache.set(key, existing)
    return existing
  }
  const pending = decodeAudio(path).catch((error: unknown) => {
    decodedCache.delete(key)
    throw error
  })
  decodedCache.set(key, pending)
  if (decodedCache.size > MAX_CACHED_CLIPS)
    decodedCache.delete(decodedCache.keys().next().value!)
  return pending
}

function decodeAudio(path: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegExecutable(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        path,
        '-map',
        '0:a:0',
        '-t',
        String(MAX_SECONDS),
        '-ac',
        '1',
        '-ar',
        String(SAMPLE_RATE),
        '-f',
        'f32le',
        'pipe:1',
      ],
      { windowsHide: true },
    )
    const chunks: Buffer[] = []
    let bytes = 0
    let errorText = ''
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      if (bytes > MAX_SECONDS * SAMPLE_RATE * 4 + 4096) {
        child.kill()
        return
      }
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      errorText = (errorText + chunk.toString()).slice(-3000)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (
        code !== 0 ||
        bytes === 0 ||
        bytes > MAX_SECONDS * SAMPLE_RATE * 4 + 4096
      ) {
        reject(new Error(errorText || 'Audio waveform could not be decoded'))
        return
      }
      const raw = Buffer.concat(chunks)
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
      const samples = new Float32Array(Math.floor(raw.byteLength / 4))
      for (let index = 0; index < samples.length; index++)
        samples[index] = view.getFloat32(index * 4, true)
      resolve(samples)
    })
  })
}

export async function getDialogueWaveform(
  store: LibraryStore,
  packStorage: string,
  recordingRoot: string,
  projectId: string,
  dialogueId: string,
): Promise<WaveformSnapshot> {
  const project = await store.getProject(projectId)
  const pack = project && (await store.getPack(project.packId))
  const dialogue = pack?.dialogues.find((item) => item.id === dialogueId)
  if (!project || !pack || !dialogue)
    throw new Error('Dialogue not found in this project')
  const selectedTake = (await store.listTakes(projectId)).find(
    (take) => take.dialogueId === dialogueId && take.selected,
  )
  const sourcePath = join(
    packAssetFolder(pack, packStorage),
    dialogue.sourceRef,
  )
  const [sourceResult, takeResult] = await Promise.allSettled([
    cachedAudio(sourcePath),
    selectedTake
      ? cachedAudio(recordingPath(recordingRoot, selectedTake))
      : Promise.resolve(null),
  ])
  if (sourceResult.status === 'rejected') throw sourceResult.reason
  const source = sourceResult.value
  const take = takeResult.status === 'fulfilled' ? takeResult.value : null
  const sourceDurationSeconds = source.length / SAMPLE_RATE
  if (sourceDurationSeconds <= 0)
    throw new Error('Source dialogue audio is empty')
  // Show visual pre-roll and tail around the source clip.
  const windowStartSeconds = -RECORDING_LEAD_IN_SECONDS
  const windowSeconds =
    sourceDurationSeconds + RECORDING_LEAD_IN_SECONDS + RECORDING_TAIL_SECONDS
  return {
    sourceDurationSeconds,
    windowStartSeconds,
    windowSeconds,
    original: waveformPeaks(
      [source],
      SAMPLE_RATE,
      windowSeconds,
      -windowStartSeconds,
    ),
    take:
      take && selectedTake
        ? waveformPeaks(
            [take],
            SAMPLE_RATE,
            windowSeconds,
            selectedTake.offsetSeconds - windowStartSeconds,
          )
        : null,
    warning:
      selectedTake && takeResult.status === 'rejected'
        ? 'Selected take waveform could not be decoded.'
        : undefined,
  }
}
