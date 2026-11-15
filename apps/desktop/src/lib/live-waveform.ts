export const LIVE_WAVEFORM_BINS = 180

export interface LiveTakeWaveform {
  dialogueId: string
  peaks: number[]
  lastBin: number
}

export function newLiveTakeWaveform(dialogueId: string): LiveTakeWaveform {
  return {
    dialogueId,
    peaks: Array(LIVE_WAVEFORM_BINS).fill(0),
    lastBin: -1,
  }
}

export function appendLiveSample(
  current: LiveTakeWaveform,
  elapsedSeconds: number,
  durationSeconds: number,
  amplitude: number,
): LiveTakeWaveform {
  if (
    !Number.isFinite(elapsedSeconds) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 ||
    !Number.isFinite(amplitude)
  )
    return current

  const bin = Math.min(
    LIVE_WAVEFORM_BINS - 1,
    Math.max(
      0,
      Math.floor((elapsedSeconds / durationSeconds) * LIVE_WAVEFORM_BINS),
    ),
  )
  const value = Math.min(1, Math.max(0, amplitude))
  const peaks = current.peaks.slice()
  for (let index = current.lastBin + 1; index < bin; index++)
    peaks[index] = value
  peaks[bin] = Math.max(peaks[bin], value)
  return { ...current, peaks, lastBin: Math.max(current.lastBin, bin) }
}
