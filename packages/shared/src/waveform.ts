/** RMS amplitude in fixed bins on a shared timeline. Offset places the clip relative to the cue. */
export interface WaveformSnapshot {
  sourceDurationSeconds: number
  windowStartSeconds: number
  windowSeconds: number
  original: number[]
  take: number[] | null
  warning?: string
}

export function waveformPeaks(
  channels: readonly Float32Array[],
  sampleRate: number,
  windowSeconds: number,
  offsetSeconds: number,
  bins = 180,
): number[] {
  if (
    !channels.length ||
    !Number.isFinite(sampleRate) ||
    sampleRate <= 0 ||
    !Number.isFinite(windowSeconds) ||
    windowSeconds <= 0 ||
    !Number.isFinite(offsetSeconds) ||
    !Number.isInteger(bins) ||
    bins <= 0
  )
    throw new Error('Invalid waveform input')

  const length = Math.min(...channels.map((channel) => channel.length))
  return Array.from({ length: bins }, (_, bin) => {
    const start = Math.max(
      0,
      Math.floor(((bin * windowSeconds) / bins - offsetSeconds) * sampleRate),
    )
    const end = Math.min(
      length,
      Math.ceil(
        (((bin + 1) * windowSeconds) / bins - offsetSeconds) * sampleRate,
      ),
    )
    if (end <= start) return 0
    const stride = Math.max(1, Math.floor((end - start) / 96))
    let sum = 0
    let count = 0
    for (let index = start; index < end; index += stride) {
      for (const channel of channels) sum += channel[index] ** 2
      count += channels.length
    }
    return Math.min(1, Math.sqrt(sum / count))
  })
}
