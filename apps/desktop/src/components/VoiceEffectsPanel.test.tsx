import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createVoiceEffect } from '@studio/shared'
import { VoiceEffectsPanel } from './VoiceEffectsPanel'

describe('voice preset fine tune', () => {
  it('shows the tuning values selected by each preset', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <VoiceEffectsPanel
        effect={createVoiceEffect('original')}
        onChange={onChange}
      />,
    )
    fireEvent.change(screen.getByLabelText('Preset'), {
      target: { value: 'deep' },
    })
    expect(onChange).toHaveBeenCalledWith(createVoiceEffect('deep'))
    rerender(
      <VoiceEffectsPanel
        effect={createVoiceEffect('deep')}
        onChange={onChange}
      />,
    )
    expect(
      screen.getByText('Pitch').closest('label')?.querySelector('input'),
    ).toHaveValue('-5')
    expect(
      screen.getByText('Tone').closest('label')?.querySelector('input'),
    ).toHaveValue('-36')
    fireEvent.change(
      screen.getByText('Pitch').closest('label')!.querySelector('input')!,
      {
        target: { value: '-4' },
      },
    )
    const custom = onChange.mock.lastCall?.[0]
    expect(custom).toMatchObject({
      preset: 'custom',
      basePreset: 'deep',
      pitch: -4,
    })
    rerender(<VoiceEffectsPanel effect={custom} onChange={onChange} />)
    expect(screen.getByLabelText('Preset')).toHaveValue('custom')
    fireEvent.change(
      screen.getByText('Pitch').closest('label')!.querySelector('input')!,
      {
        target: { value: '-5' },
      },
    )
    expect(onChange.mock.lastCall?.[0]).toMatchObject({
      preset: 'deep',
      pitch: -5,
    })
    expect(onChange.mock.lastCall?.[0].basePreset).toBeUndefined()
  })
})
