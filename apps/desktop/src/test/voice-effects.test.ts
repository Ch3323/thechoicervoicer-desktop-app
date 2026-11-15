// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import {
  createVoiceEffect,
  tuneVoiceEffect,
  VoiceEffectSchema,
} from '@studio/shared'
import { ffmpegExecutable } from '../../electron/preview-proxy'
import { voiceEffectFilters } from '../../electron/voice-effects'

const presets = [
  'original',
  'deep',
  'cartoon',
  'robot',
  'radio',
  'echo',
  'hall',
  'cave',
  'megaphone',
  'alien',
  'monster',
  'chorus',
  'underwater',
  'custom',
] as const

describe('voice effect presets', () => {
  it.each([
    ['deep', -5, -36, 12, 8, 0, 0],
    ['cartoon', 7, 34, 5, 3, 0, 6],
    ['robot', -2, -15, 42, 6, 4, 55],
    ['echo', 0, 0, 0, 8, 82, 0],
    ['hall', 0, -8, 0, 88, 14, 0],
    ['cave', -2, -28, 8, 100, 42, 10],
    ['megaphone', 0, 78, 38, 4, 7, 0],
    ['alien', 4, -30, 35, 18, 12, 65],
    ['monster', -8, -62, 48, 35, 14, 38],
    ['chorus', 0, 10, 3, 18, 8, 50],
    ['underwater', -2, -94, 6, 42, 6, 18],
  ] as const)(
    '%s uses the specified tuning',
    (preset, pitch, tone, texture, space, echo, mod) => {
      expect(createVoiceEffect(preset)).toMatchObject({
        pitch,
        tone,
        texture,
        space,
        echo,
        mod,
      })
    },
  )

  it('renders every preset with the bundled FFmpeg', () => {
    for (const preset of presets) {
      const effect = createVoiceEffect(preset)
      const filters = voiceEffectFilters(effect)
      if (preset === 'original' || preset === 'custom') {
        expect(filters).toEqual([])
        continue
      }
      expect(filters.length).toBeGreaterThan(0)
      const result = spawnSync(
        ffmpegExecutable(),
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=0.15',
          '-af',
          filters.join(','),
          '-f',
          'null',
          '-',
        ],
        { encoding: 'utf8', windowsHide: true },
      )
      expect(result.status, `${preset}: ${result.stderr}`).toBe(0)
    }
  })
  it('uses saved absolute tuning values without legacy migration', () => {
    const effect = VoiceEffectSchema.parse({
      preset: 'deep',
      pitch: 0,
      tone: 0,
      texture: 0,
      space: 0,
      echo: 0,
      mod: 0,
    })

    expect(voiceEffectFilters(effect)).toEqual([])

    expect(voiceEffectFilters(effect)).not.toEqual(
      voiceEffectFilters(createVoiceEffect('deep')),
    )
  })

  it('compensates loudness after effect processing', () => {
    const filters = voiceEffectFilters(createVoiceEffect('deep'))
    expect(filters).toContain('loudnorm=I=-20:TP=-3:LRA=11')
    expect(filters.at(-1)).toBe('aresample=48000')
    const meanVolume = (chain: string[]) => {
      const result = spawnSync(
        ffmpegExecutable(),
        [
          '-hide_banner',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=1',
          '-af',
          [...chain, 'volumedetect'].join(','),
          '-f',
          'null',
          '-',
        ],
        { encoding: 'utf8', windowsHide: true },
      )
      expect(result.status, result.stderr).toBe(0)
      return Number(/mean_volume: (-?\d+\.\d+) dB/.exec(result.stderr)?.[1])
    }
    expect(Math.abs(meanVolume(filters) - meanVolume([]))).toBeLessThan(4)
  })

  it('keeps structural processing when fine tuning changes to Custom', () => {
    const custom = tuneVoiceEffect(createVoiceEffect('underwater'), 'tone', -93)
    expect(custom).toMatchObject({ preset: 'custom', basePreset: 'underwater' })
    expect(voiceEffectFilters(custom)).toContain('lowpass=f=650')
  })
})
