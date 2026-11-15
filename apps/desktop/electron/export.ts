import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { stat, rm, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import {
  buildAudioTimeline,
  type AudioTimeline,
  type ExportOptions,
  type ExportProgress,
  type ExportResult,
  type VoiceEffect,
} from '@studio/shared'
import { LibraryStore } from './library-store'
import { packAssetFolder } from './pack-files'
import { ffmpegExecutable } from './preview-proxy'
import { recordingPath } from './recordings'
import { voiceEffectFilters } from './voice-effects'

function ffmpegRun(
  args: string[],
  onProgress?: (line: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const child = spawn(ffmpegExecutable(), args, { windowsHide: true })
    const abort = () => child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    let stderr = ''
    let stdout = ''
    let pendingLine = ''
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      stdout = (stdout + text).slice(-16_000)
      pendingLine += text
      const lines = pendingLine.split(/\r?\n/)
      pendingLine = lines.pop() ?? ''
      for (const line of lines) if (line) onProgress?.(line)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-12_000)
    })
    child.once('error', reject)
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) reject(signal.reason)
      else if (code === 0) resolve(`${stdout}\n${stderr}`)
      else reject(new Error(stderr || `FFmpeg exited with code ${code}`))
    })
    if (signal?.aborted) abort()
  })
}

export function parseDuration(ffmpegOutput: string): number {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(ffmpegOutput)
  if (!match) throw new Error('Unable to determine the source video duration')
  const seconds =
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new Error('Source video has no usable duration')
  return seconds
}

async function videoDuration(videoPath: string, signal?: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const child = spawn(ffmpegExecutable(), ['-hide_banner', '-i', videoPath], {
      windowsHide: true,
    })
    const abort = () => child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    let output = ''
    child.stderr.on('data', (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-20_000)
    })
    child.once('error', reject)
    child.once('close', () => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) return reject(signal.reason)
      try {
        resolve(parseDuration(output))
      } catch (error) {
        reject(error)
      }
    })
    if (signal?.aborted) abort()
  })
}

export function buildFilterGraph(
  timeline: AudioTimeline,
  duration: number,
  backingTrackUsed: boolean,
  backingVolume = 1,
  effects: Record<string, VoiceEffect> = {},
): string {
  const fixedDuration = duration.toFixed(3)
  const lines: string[] = []
  if (backingTrackUsed) {
    lines.push(
      `[1:a:0]aresample=48000,aformat=channel_layouts=stereo,volume=${backingVolume.toFixed(2)},asetpts=PTS-STARTPTS,apad,atrim=duration=${fixedDuration}[bed]`,
    )
  } else {
    lines.push(
      `anullsrc=channel_layout=stereo:sample_rate=48000,atrim=duration=${fixedDuration}[bed]`,
    )
  }
  const firstTakeInput = backingTrackUsed ? 2 : 1
  timeline.placements.forEach((placement, index) => {
    const delayMs = Math.round(placement.startSeconds * 1000)
    const filters = voiceEffectFilters(effects[placement.dialogueId])
    lines.push(
      `[${firstTakeInput + index}:a:0]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${placement.trimStartSeconds.toFixed(3)}:end=${placement.durationSeconds.toFixed(3)},asetpts=PTS-STARTPTS,${filters.length ? `${filters.join(',')},` : ''}adelay=${delayMs}:all=1[t${index}]`,
    )
  })
  if (timeline.placements.length === 0) {
    lines.push('[bed]anull[mix]')
  } else {
    const inputs = [
      '[bed]',
      ...timeline.placements.map((_, index) => `[t${index}]`),
    ].join('')
    lines.push(
      `${inputs}amix=inputs=${timeline.placements.length + 1}:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95,atrim=duration=${fixedDuration}[mix]`,
    )
  }
  return lines.join(';\n')
}

const running = new Set<string>()

export async function exportProject(
  store: LibraryStore,
  packStorage: string,
  recordingRoot: string,
  projectId: string,
  options: ExportOptions,
  outputPath: string,
  onProgress: (progress: ExportProgress) => void,
  persistExport = true,
  signal?: AbortSignal,
): Promise<ExportResult> {
  signal?.throwIfAborted()
  if (running.has(projectId))
    throw new Error('An export for this project is already running')
  running.add(projectId)
  const temporary = join(
    dirname(outputPath),
    `.${basename(outputPath)}.${randomUUID()}.tmp.mp4`,
  )
  const scriptPath = `${temporary}.filter.txt`
  try {
    const project = await store.getProject(projectId)
    if (!project) throw new Error('Project not found')
    const pack = await store.getPack(project.packId)
    if (!pack) throw new Error('Project Dub Pack is unavailable')
    const takes = await store.listTakes(projectId)
    const timeline = buildAudioTimeline(pack, project, takes)
    if (options.requireComplete && timeline.missingDialogueIds.length > 0)
      throw new Error(
        `${timeline.missingDialogueIds.length} required dialogue lines have no selected take`,
      )

    const packFolder = packAssetFolder(pack, packStorage)
    const video = join(packFolder, pack.videoRef)
    const duration = await videoDuration(video, signal)
    let backing: string | null = null
    const warnings: string[] = []
    if (options.useBackingTrack && pack.backingTrackRef) {
      const candidate = join(packFolder, pack.backingTrackRef)
      try {
        await stat(candidate)
        backing = candidate
      } catch {
        warnings.push('Backing track is missing; gaps will be silent.')
      }
    } else {
      warnings.push(
        'No backing track used; gaps will be silent. Original video audio is excluded to avoid doubled dialogue.',
      )
    }
    const takePaths = timeline.placements.map((placement) => {
      const take = takes.find((item) => item.id === placement.takeId)
      if (!take) throw new Error('A selected recording is missing')
      return recordingPath(recordingRoot, take)
    })
    for (const path of takePaths) await stat(path)
    signal?.throwIfAborted()
    await writeFile(
      scriptPath,
      buildFilterGraph(
        timeline,
        duration,
        backing !== null,
        options.backingVolume ?? 1,
        project.voiceEffects ?? {},
      ),
      'utf8',
    )

    const args = ['-hide_banner', '-y', '-i', video]
    if (backing) args.push('-i', backing)
    for (const path of takePaths) args.push('-i', path)
    args.push(
      '-filter_complex_script',
      scriptPath,
      '-map',
      '0:v:0',
      '-map',
      '[mix]',
      '-t',
      duration.toFixed(3),
      '-c:v',
      'libx264',
      '-preset',
      options.fastMode ? 'ultrafast' : 'medium',
      '-crf',
      options.fastMode ? '26' : '20',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      temporary,
    )
    onProgress({ projectId, percent: 0, message: 'Rendering video and audio…' })
    await ffmpegRun(args, (line) => {
      if (!line.startsWith('out_time=')) return
      const time = line.slice('out_time='.length)
      const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(time)
      if (!match) return
      const elapsed =
        Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
      onProgress({
        projectId,
        percent: Math.min(
          99,
          Math.max(0, Math.round((elapsed / duration) * 100)),
        ),
        message: 'Rendering video and audio…',
      })
    }, signal)
    signal?.throwIfAborted()
    await rename(temporary, outputPath)
    if (persistExport) await store.setLastExport(projectId, outputPath)
    onProgress({ projectId, percent: 100, message: 'Export complete' })
    return { outputPath, backingTrackUsed: backing !== null, warnings }
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  } finally {
    await rm(scriptPath, { force: true })
    running.delete(projectId)
  }
}
