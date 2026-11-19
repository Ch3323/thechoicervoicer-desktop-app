import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { dismissErrorToast, getErrorToasts, reportError } from '@/lib/error-toast'
import { ErrorToasts } from '@/components/ErrorToasts'

afterEach(() => {
  cleanup()
  for (const toast of getErrorToasts()) dismissErrorToast(toast.id)
  vi.useRealTimers()
})

it('formats errors, deduplicates them, and displays queued errors after dismissal', () => {
  render(<ErrorToasts />)

  act(() => {
    reportError("Error invoking remote method 'pack:import': Error: Choose a Dub Pack.")
    reportError(new Error('Choose a Dub Pack.'))
    reportError('Microphone recording failed.')
    reportError('Video preview unavailable.')
    reportError('Could not save your take.')
  })

  expect(screen.getAllByRole('alert')).toHaveLength(3)
  expect(screen.getByText('Choose a Dub Pack.')).toBeInTheDocument()
  expect(screen.queryByText('Could not save your take.')).toBeNull()
  fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss error' })[0])
  expect(screen.queryByText('Choose a Dub Pack.')).toBeNull()
  expect(screen.getByText('Could not save your take.')).toBeInTheDocument()
})

it('keeps a toast open while it has keyboard focus and expires it afterward', () => {
  vi.useFakeTimers()
  render(<ErrorToasts />)
  act(() => reportError('Microphone recording failed.'))

  const dismiss = screen.getByRole('button', { name: 'Dismiss error' })
  act(() => dismiss.focus())
  act(() => vi.advanceTimersByTime(8000))
  expect(screen.getByRole('alert')).toBeInTheDocument()

  act(() => dismiss.blur())
  act(() => vi.advanceTimersByTime(8000))
  expect(screen.queryByRole('alert')).toBeNull()
})
