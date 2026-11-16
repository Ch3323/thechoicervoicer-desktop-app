import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

describe('ConfirmDialog', () => {
  it('keeps focus and ignores clicks outside the dialog content', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(
      <ConfirmDialog
        title="Delete recording?"
        description="Delete this recording and its takes?"
        confirmLabel="Delete recording"
        onCancel={onCancel}
        onConfirm={onConfirm}
      />,
    )
    const dialog = screen.getByRole('dialog', { name: 'Delete recording?' })
    expect(dialog).toHaveFocus()
    fireEvent.click(dialog, { clientX: 150, clientY: 150 })
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(dialog, { clientX: 50, clientY: 150 })
    expect(onCancel).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
