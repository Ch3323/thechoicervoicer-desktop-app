import { describe, expect, it } from 'vitest'
import { waveformPeaks } from '@studio/shared'

describe('waveform alignment', () => {
  it('places source and take samples in their own absolute bins', () => {
    const signal = new Float32Array([1, 1, 1, 1])
    const original = waveformPeaks([signal], 4, 3, 0, 6)
    const delayedTake = waveformPeaks([signal], 4, 3, 1, 6)
    expect(original.slice(0, 2).every((value) => value > 0)).toBe(true)
    expect(original.slice(3)).toEqual([0, 0, 0])
    expect(delayedTake.slice(0, 2)).toEqual([0, 0])
    expect(delayedTake.slice(2, 4).every((value) => value > 0)).toBe(true)
  })

  it('rejects invalid sample metadata', () => {
    expect(() => waveformPeaks([], 48000, 5, 0)).toThrow('Invalid waveform')
    expect(() => waveformPeaks([new Float32Array(1)], 0, 5, 0)).toThrow(
      'Invalid waveform',
    )
  })
})
