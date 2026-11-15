import type { VoiceEffect } from '@studio/shared'

/** FFmpeg audio filters shared by take audition and full dub rendering. */
export function voiceEffectFilters(effect: VoiceEffect | undefined): string[] {
  if (!effect) return []
  const filters: string[] = []
  const preset = effect.basePreset ?? effect.preset
  const pitch = effect.pitch
  if (pitch !== 0) {
    const factor = 2 ** (Math.max(-12, Math.min(12, pitch)) / 12)
    filters.push(
      `asetrate=${Math.round(48000 * factor)}`,
      'aresample=48000',
      `atempo=${(1 / factor).toFixed(4)}`,
    )
  }
  const tone = effect.tone
  if (tone !== 0)
    filters.push(
      `bass=g=${(-tone / 10).toFixed(2)}`,
      `treble=g=${(tone / 10).toFixed(2)}`,
    )
  if (preset === 'radio') filters.push('highpass=f=300', 'lowpass=f=3500')
  if (preset === 'megaphone') filters.push('highpass=f=500', 'lowpass=f=3000')
  if (preset === 'underwater') filters.push('lowpass=f=650')
  const texture = effect.texture
  if (texture > 0)
    filters.push(
      `acrusher=bits=${Math.max(4, Math.round(16 - texture * 0.1))}:mix=${(texture / 100).toFixed(2)}`,
    )
  if (effect.space > 0)
    filters.push(`aecho=0.8:0.5:60:${(effect.space / 300).toFixed(3)}`)
  if (preset === 'hall') filters.push('aecho=0.8:0.6:90|180:0.25|0.15')
  if (preset === 'cave') filters.push('aecho=0.8:0.7:220|430:0.35|0.22')
  if (preset === 'underwater') filters.push('aecho=0.8:0.4:120:0.18')
  if (preset === 'chorus') filters.push('aecho=0.8:0.5:25|45:0.25|0.2')
  const echo = effect.echo
  if (echo > 0) filters.push(`aecho=0.8:0.6:180:${(echo / 200).toFixed(3)}`)
  const mod = effect.mod
  if (mod > 0) filters.push(`tremolo=f=5:d=${(mod / 100).toFixed(2)}`)
  if (filters.length > 0)
    filters.push('loudnorm=I=-20:TP=-3:LRA=11', 'aresample=48000')
  return filters
}
