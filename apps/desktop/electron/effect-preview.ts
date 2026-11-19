import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { VoiceEffect } from '@studio/shared'
import { LibraryStore } from './library-store'
import { ffmpegExecutable } from './preview-proxy'
import { recordingPath } from './recordings'
import { voiceEffectFilters } from './voice-effects'

const running = new Map<string, Promise<void>>()

function render(
  source: string,
  output: string,
  filters: string[],
  duration: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegExecutable(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        source,
        '-af',
        ['aresample=48000', ...filters].join(','),
        '-t',
        duration.toFixed(3),
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        output,
      ],
      { windowsHide: true },
    )
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4000)
    })
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(stderr || `Effect render failed (${code})`)),
    )
  })
}

export async function effectTakeUrl(
  store: LibraryStore,
  recordingRoot: string,
  effectRoot: string,
  projectId: string,
  dialogueId: string,
  takeId: string,
  effect: VoiceEffect,
  gainDb = 0,
): Promise<string> {
  const [project, take] = await Promise.all([
    store.getProject(projectId),
    store.getTake(takeId),
  ])
  if (
    !project ||
    !take ||
    take.projectId !== projectId ||
    take.dialogueId !== dialogueId ||
    !take.selected
  )
    throw new Error('Selected recording not found for this dialogue')
  const filters = voiceEffectFilters(effect)
  if (gainDb !== 0) filters.push(`volume=${(10 ** (gainDb / 20)).toFixed(6)}`)
  if (filters.length === 0) return `studio-media://take/${takeId}`
  const hash = createHash('sha256')
    .update(filters.join(','))
    .digest('hex')
    .slice(0, 16)
  const filename = `${takeId}-${hash}.m4a`
  const folder = join(effectRoot, projectId)
  const output = join(folder, filename)
  try {
    await stat(output)
    return `studio-media://effect/${projectId}/${filename}`
  } catch {
    /* render below */
  }
  const key = `${projectId}/${filename}`
  let pending = running.get(key)
  if (!pending) {
    pending = (async () => {
      await mkdir(folder, { recursive: true })
      const temporary = join(folder, `${takeId}-${randomUUID()}.m4a`)
      try {
        await render(
          recordingPath(recordingRoot, take),
          temporary,
          filters,
          take.durationSeconds,
        )
        await rename(temporary, output)
      } catch (error) {
        await rm(temporary, { force: true })
        throw error
      }
    })().finally(() => running.delete(key))
    running.set(key, pending)
  }
  await pending
  return `studio-media://effect/${projectId}/${filename}`
}
