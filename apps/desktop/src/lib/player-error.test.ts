import { describe, expect, it } from 'vitest'
import { playerError } from './player-error'

describe('playerError', () => {
  it('turns system codes into useful actions', () => {
    expect(playerError("Error invoking remote method 'import-pack': Error: ENOENT: no such file or directory, open 'C:\\missing.zip'"))
      .toContain('needed file could not be found')
    expect(playerError('Error: ENOSPC: no space left on device'))
      .toContain('Free up some space')
    expect(playerError(new Error('NotAllowedError: Permission denied')))
      .toContain('Microphone access')
  })

  it('keeps clear validation guidance but hides diagnostic text', () => {
    expect(playerError('Error: Choose at least one available role'))
      .toBe('Choose at least one available role')
    expect(playerError('TypeError: Cannot read properties of undefined'))
      .toBe('Something went wrong. Please try again.')
    expect(playerError('FFmpeg exited with code 1'))
      .toContain('video or audio could not be processed')
  })
})
