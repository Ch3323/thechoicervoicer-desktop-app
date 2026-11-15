import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

describe('ConfirmDialog', () => {
  it('ignores empty space inside the dialog and cancels on a backdrop click', () => {
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
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      left: 100, right: 400, top: 100, bottom: 300,
    } as DOMRect)

    fireEvent.click(dialog, { clientX: 150, clientY: 150 })
    expect(onCancel).not.toHaveBeenCalled()
    fireEvent.click(dialog, { clientX: 50, clientY: 150 })
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
