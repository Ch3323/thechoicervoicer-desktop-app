import { describe, expect, it } from 'vitest'
import { formatCueTime } from './format-cue-time'

describe('formatCueTime', () => {
  it('shows whole minutes and seconds with leading zeroes', () => {
    expect(formatCueTime(0)).toBe('00:00')
    expect(formatCueTime(9.9)).toBe('00:09')
    expect(formatCueTime(60)).toBe('01:00')
    expect(formatCueTime(125.9)).toBe('02:05')
  })
})
