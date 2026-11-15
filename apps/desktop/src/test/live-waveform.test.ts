import { describe, expect, it } from 'vitest'
import {
  appendLiveSample,
  LIVE_WAVEFORM_BINS,
  newLiveTakeWaveform,
} from '@/lib/live-waveform'

describe('live recording waveform', () => {
  it('places microphone samples on the full original clip window', () => {
    const empty = newLiveTakeWaveform('line-1')
    const middle = appendLiveSample(empty, 1, 2, 0.6)
    const end = appendLiveSample(middle, 2, 2, 0.8)
    expect(empty.peaks.every((peak) => peak === 0)).toBe(true)
    expect(middle.peaks[90]).toBe(0.6)
    expect(end.peaks).toHaveLength(LIVE_WAVEFORM_BINS)
    expect(end.peaks[LIVE_WAVEFORM_BINS - 1]).toBe(0.8)
    expect(end.lastBin).toBe(LIVE_WAVEFORM_BINS - 1)
  })
})
