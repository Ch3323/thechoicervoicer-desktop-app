import type { VoiceEffect } from './models'

type Preset = VoiceEffect['preset']
type Tuning = Pick<
  VoiceEffect,
  'pitch' | 'tone' | 'texture' | 'space' | 'echo' | 'mod'
>
type TuningKey = keyof Tuning
const tuningKeys: TuningKey[] = [
  'pitch',
  'tone',
  'texture',
  'space',
  'echo',
  'mod',
]

export const voicePresetTuning: Record<Preset, Tuning> = {
  original: { pitch: 0, tone: 0, texture: 0, space: 0, echo: 0, mod: 0 },
  deep: { pitch: -5, tone: -36, texture: 12, space: 8, echo: 0, mod: 0 },
  cartoon: { pitch: 7, tone: 34, texture: 5, space: 3, echo: 0, mod: 6 },
  robot: { pitch: -2, tone: -15, texture: 42, space: 6, echo: 4, mod: 55 },
  radio: { pitch: 0, tone: 0, texture: 25, space: 0, echo: 0, mod: 0 },
  echo: { pitch: 0, tone: 0, texture: 0, space: 8, echo: 82, mod: 0 },
  hall: { pitch: 0, tone: -8, texture: 0, space: 88, echo: 14, mod: 0 },
  cave: { pitch: -2, tone: -28, texture: 8, space: 100, echo: 42, mod: 10 },
  megaphone: { pitch: 0, tone: 78, texture: 38, space: 4, echo: 7, mod: 0 },
  alien: { pitch: 4, tone: -30, texture: 35, space: 18, echo: 12, mod: 65 },
  monster: { pitch: -8, tone: -62, texture: 48, space: 35, echo: 14, mod: 38 },
  chorus: { pitch: 0, tone: 10, texture: 3, space: 18, echo: 8, mod: 50 },
  underwater: { pitch: -2, tone: -94, texture: 6, space: 42, echo: 6, mod: 18 },
  custom: { pitch: 0, tone: 0, texture: 0, space: 0, echo: 0, mod: 0 },
}

export function createVoiceEffect(preset: Preset): VoiceEffect {
  return { preset, ...voicePresetTuning[preset] }
}

export function tuneVoiceEffect(
  effect: VoiceEffect,
  key: TuningKey,
  value: number,
): VoiceEffect {
  const tuned = { ...effect, [key]: value }

  const matchingPreset = (Object.keys(voicePresetTuning) as Preset[]).find(
    (preset) =>
      preset !== 'custom' &&
      tuningKeys.every(
        (item) => tuned[item] === voicePresetTuning[preset][item],
      ),
  )

  if (matchingPreset) {
    const matched: VoiceEffect = { ...tuned, preset: matchingPreset }
    delete matched.basePreset
    return matched
  }

  const basePreset =
    effect.basePreset ??
    (effect.preset === 'custom' ? undefined : effect.preset)

  return {
    ...tuned,
    preset: 'custom',
    basePreset,
  }
}
