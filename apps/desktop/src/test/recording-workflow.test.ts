// @vitest-environment node
import { spawn } from 'node:child_process'
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildAudioTimeline } from '@studio/shared'
import {
  buildFilterGraph,
  exportProject,
  parseDuration,
} from '../../electron/export'
import { effectTakeUrl } from '../../electron/effect-preview'
import { localPreviewTakeAudio } from '../../electron/preview-take'
import { LibraryStore } from '../../electron/library-store'
import { importFolder } from '../../electron/pack-files'
import { ffmpegExecutable } from '../../electron/preview-proxy'
import { saveRecording } from '../../electron/recordings'
import { getDialogueWaveform } from '../../electron/waveform'

let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'studio-workflow-test-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function ffmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegExecutable(), args, { windowsHide: true })
    let output = ''
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(output)),
    )
  })
}

function inspect(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegExecutable(), ['-hide_banner', '-i', path], {
      windowsHide: true,
    })
    let output = ''
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', () => resolve(output))
  })
}

describe('single-player persistence and export', () => {
  it.skipIf(process.platform !== 'win32')(
    'exports a project whose selected takes exceed the Windows command limit',
    async () => {
      const folder = join(root, 'Large Scene')
      const userData = join(root, 'user-data')
      const recordings = join(userData, 'recordings')
      await mkdir(folder)
      await ffmpeg([
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=blue:s=160x90:r=10:d=0.5',
        '-c:v',
        'libtheora',
        '-an',
        join(folder, 'dub_video.ogv'),
      ])
      await ffmpeg([
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=0.1',
        '-c:a',
        'pcm_s16le',
        join(root, 'line.wav'),
      ])
      const bytes = new Uint8Array(await readFile(join(root, 'line.wav')))
      for (let index = 0; index < 150; index++) {
        const name = String(index + 1).padStart(3, '0')
        await writeFile(join(folder, `${name}_Line.wav`), bytes)
        await writeFile(
          join(folder, `${name}_Line.ini`),
          `[data]\ncaption="Line ${name}"\ndub_timestamps=[0.1]\ndub_characters=["Speaker"]`,
        )
      }
      const pack = await importFolder(folder)
      const store = new LibraryStore(userData)
      await store.savePack(pack)
      const project = await store.createProject(pack.id)
      for (const dialogue of pack.dialogues) {
        await saveRecording(recordings, store, {
          projectId: project.id,
          dialogueId: dialogue.id,
          mimeType: 'audio/wav',
          durationSeconds: 0.1,
          bytes,
        })
      }
      const output = join(root, 'large-export.mp4')
      const progress: string[] = []
      await exportProject(
        store,
        join(userData, 'packs'),
        recordings,
        project.id,
        { useBackingTrack: false, requireComplete: true, fastMode: true },
        output,
        (update) => progress.push(update.message),
      )
      expect(
        progress.some((message) => message.startsWith('Preparing audio 1 of ')),
      ).toBe(true)
      expect(await inspect(output)).toContain('Audio: aac')
      expect(
        (await readdir(root)).filter((name) =>
          name.includes('large-export.mp4.'),
        ),
      ).toEqual([])
    },
    120_000,
  )

  it('imports, saves and selects retakes, resumes, then renders full-duration H.264/AAC', async () => {
    const folder = join(root, 'Scene')
    const userData = join(root, 'user-data')
    const recordings = join(userData, 'recordings')
    await mkdir(folder)
    await ffmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=blue:s=160x90:r=10:d=2',
      '-c:v',
      'libtheora',
      '-an',
      join(folder, 'dub_video.ogv'),
    ])
    await ffmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=110:duration=2',
      '-c:a',
      'aac',
      join(folder, '_backing_track.m4a'),
    ])
    await ffmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=0.4',
      '-c:a',
      'pcm_s16le',
      join(folder, '01_Line.wav'),
    ])
    await ffmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=660:duration=0.4',
      '-c:a',
      'libopus',
      join(root, 'retake.webm'),
    ])
    await writeFile(
      join(folder, '01_Line.ini'),
      '[data]\ncaption="Hello"\ndub_timestamps=[0.5]\ndub_characters=["Speaker"]',
    )

    const sourceDuration = parseDuration(
      await inspect(join(folder, 'dub_video.ogv')),
    )
    const pack = await importFolder(folder)
    expect(pack.backingTrackRef).toBe('_backing_track.m4a')
    const store = new LibraryStore(userData)
    await store.savePack(pack)
    const project = await store.createProject(pack.id)
    const bytes = new Uint8Array(await readFile(join(folder, '01_Line.wav')))
    const first = await saveRecording(recordings, store, {
      projectId: project.id,
      dialogueId: pack.dialogues[0].id,
      mimeType: 'audio/wav',
      durationSeconds: 0.4,
      offsetSeconds: -1,
      bytes,
    })
    const second = await saveRecording(recordings, store, {
      projectId: project.id,
      dialogueId: pack.dialogues[0].id,
      mimeType: 'audio/webm;codecs=opus',
      durationSeconds: 0.4,
      bytes: new Uint8Array(await readFile(join(root, 'retake.webm'))),
    })
    expect(
      (await store.listTakes(project.id))
        .filter((take) => take.selected)
        .map((take) => take.id),
    ).toEqual([second.id])
    await store.selectTake(project.id, pack.dialogues[0].id, first.id)
    await store.selectTake(project.id, pack.dialogues[0].id, second.id)
    await store.updateTakeOffset(second.id, 0.15)

    const reopened = new LibraryStore(userData)
    const savedProject = (await reopened.listProjects())[0]
    const savedTakes = await reopened.listTakes(project.id)
    expect(savedTakes).toHaveLength(2)
    expect(savedTakes.find((take) => take.id === first.id)?.selected).toBe(
      false,
    )
    expect(savedTakes.find((take) => take.id === first.id)?.offsetSeconds).toBe(
      -1,
    )
    expect(savedTakes.find((take) => take.id === second.id)).toMatchObject({
      selected: true,
      offsetSeconds: 0.15,
    })
    const rawPreview = await localPreviewTakeAudio(
      reopened,
      recordings,
      join(userData, 'effect-previews'),
      project.id,
      pack.dialogues[0].id,
      second.id,
    )
    expect(rawPreview.mimeType).toBe('audio/webm')
    expect(rawPreview.bytes).toEqual(
      new Uint8Array(await readFile(join(root, 'retake.webm'))),
    )
    await expect(
      localPreviewTakeAudio(
        reopened,
        recordings,
        join(userData, 'effect-previews'),
        project.id,
        pack.dialogues[0].id,
        first.id,
      ),
    ).rejects.toThrow('Selected recording not found')
    expect(
      buildAudioTimeline(pack, savedProject, savedTakes).placements[0]
        .startSeconds,
    ).toBeCloseTo(0.65)
    expect(
      buildFilterGraph(
        buildAudioTimeline(pack, savedProject, savedTakes),
        sourceDuration,
        true,
        0.5,
        savedProject.voiceEffects ?? {},
        1.5,
      ),
    ).toContain('volume=1.50,adelay=650:all=1')

    const waveform = await getDialogueWaveform(
      reopened,
      join(userData, 'packs'),
      recordings,
      project.id,
      pack.dialogues[0].id,
    )
    expect(waveform.sourceDurationSeconds).toBeGreaterThan(0.3)
    expect(waveform.windowStartSeconds).toBe(-1)
    expect(waveform.windowSeconds).toBeCloseTo(
      waveform.sourceDurationSeconds + 2,
    )
    expect(waveform.original.some((value) => value > 0)).toBe(true)
    expect(waveform.take?.some((value) => value > 0)).toBe(true)

    await reopened.updateVoiceEffect(project.id, pack.dialogues[0].id, {
      preset: 'robot',
      pitch: 2,
      tone: 10,
      texture: 30,
      space: 10,
      echo: 10,
      mod: 10,
    })
    const effectUrl = await effectTakeUrl(
      reopened,
      recordings,
      join(userData, 'effect-previews'),
      project.id,
      pack.dialogues[0].id,
      second.id,
      {
        preset: 'robot',
        pitch: 2,
        tone: 10,
        texture: 30,
        space: 10,
        echo: 10,
        mod: 10,
      },
    )
    expect(effectUrl).toContain('studio-media://effect/')
    const auditionFile = join(
      userData,
      'effect-previews',
      project.id,
      effectUrl.split('/').at(-1)!,
    )
    expect(await inspect(auditionFile)).toContain('Audio: aac')
    const boostedUrl = await effectTakeUrl(
      reopened,
      recordings,
      join(userData, 'effect-previews'),
      project.id,
      pack.dialogues[0].id,
      second.id,
      {
        preset: 'original',
        pitch: 0,
        tone: 0,
        texture: 0,
        space: 0,
        echo: 0,
        mod: 0,
      },
      24,
    )
    expect(boostedUrl).toContain('studio-media://effect/')
    expect(
      await inspect(
        join(
          userData,
          'effect-previews',
          project.id,
          boostedUrl.split('/').at(-1)!,
        ),
      ),
    ).toContain('Audio: aac')
    const boostedPreview = await localPreviewTakeAudio(
      reopened,
      recordings,
      join(userData, 'effect-previews'),
      project.id,
      pack.dialogues[0].id,
      second.id,
      undefined,
      24,
    )
    expect(boostedPreview.mimeType).toBe('audio/mp4')
    expect(boostedPreview.bytes.byteLength).toBeGreaterThan(0)
    const effectPreview = await localPreviewTakeAudio(
      reopened,
      recordings,
      join(userData, 'effect-previews'),
      project.id,
      pack.dialogues[0].id,
      second.id,
      {
        preset: 'robot',
        pitch: 2,
        tone: 10,
        texture: 30,
        space: 10,
        echo: 10,
        mod: 10,
      },
    )
    expect(effectPreview.mimeType).toBe('audio/mp4')
    expect(effectPreview.bytes).toEqual(
      new Uint8Array(await readFile(auditionFile)),
    )
    const previewPath = join(root, 'preview.mp4')
    await exportProject(
      reopened,
      join(userData, 'packs'),
      recordings,
      project.id,
      {
        useBackingTrack: true,
        requireComplete: false,
        backingVolume: 0.5,
        fastMode: true,
      },
      previewPath,
      () => undefined,
      false,
    )
    expect(await inspect(previewPath)).toContain('Video: h264')
    expect(
      (await reopened.getProject(project.id))?.lastExportPath,
    ).toBeUndefined()

    const output = join(root, 'dubbed.mp4')
    const progress: number[] = []
    const result = await exportProject(
      reopened,
      join(userData, 'packs'),
      recordings,
      project.id,
      { useBackingTrack: true, requireComplete: true },
      output,
      (update) => progress.push(update.percent),
    )
    expect(result.backingTrackUsed).toBe(true)
    expect(progress.at(-1)).toBe(100)
    const media = await inspect(output)
    expect(media).toContain('Video: h264')
    expect(media).toContain('Audio: aac')
    expect(parseDuration(media)).toBeCloseTo(sourceDuration, 1)
    expect((await reopened.getProject(project.id))?.lastExportPath).toBe(output)

    const silentGapsOutput = join(root, 'dubbed-without-backing.mp4')
    const noBacking = await exportProject(
      reopened,
      join(userData, 'packs'),
      recordings,
      project.id,
      { useBackingTrack: false, requireComplete: true },
      silentGapsOutput,
      () => undefined,
    )
    expect(noBacking.backingTrackUsed).toBe(false)
    expect(noBacking.warnings.join(' ')).toContain('gaps will be silent')
    expect(await inspect(silentGapsOutput)).toContain('Audio: aac')

    const canceledPath = join(root, 'canceled.mp4')
    const controller = new AbortController()
    await expect(
      exportProject(
        reopened,
        join(userData, 'packs'),
        recordings,
        project.id,
        { useBackingTrack: false, requireComplete: true },
        canceledPath,
        (update) => {
          if (update.percent > 0) controller.abort()
        },
        false,
        controller.signal,
      ),
    ).rejects.toThrow()
    expect(await readdir(root)).not.toContain('canceled.mp4')
    expect(
      (await readdir(root)).some((name) => name.includes('canceled.mp4.')),
    ).toBe(false)
  }, 60_000)

  it('blocks an incomplete project when the complete-only option is enabled', async () => {
    const folder = join(root, 'Scene')
    await mkdir(folder)
    await Promise.all([
      writeFile(join(folder, 'dub_video.ogv'), 'video'),
      writeFile(join(folder, '01_Line.wav'), 'audio'),
      writeFile(
        join(folder, '01_Line.ini'),
        '[data]\ndub_timestamps=[1]\ndub_characters=["A"]',
      ),
    ])
    const pack = await importFolder(folder)
    const store = new LibraryStore(join(root, 'data'))
    await store.savePack(pack)
    const project = await store.createProject(pack.id)
    await expect(
      exportProject(
        store,
        join(root, 'data', 'packs'),
        join(root, 'data', 'recordings'),
        project.id,
        { useBackingTrack: false, requireComplete: true },
        join(root, 'blocked.mp4'),
        () => undefined,
      ),
    ).rejects.toThrow('required dialogue lines')
  })
})
