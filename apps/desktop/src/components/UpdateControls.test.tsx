import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopApi } from '@studio/shared'
import { UpdateControls } from './UpdateControls'

afterEach(cleanup)

it('keeps manual checking available in a development build', async () => {
  const checkForUpdates = vi.fn(async () => undefined)
  window.studio = {
    getUpdateStatus: async () => ({ phase: 'disabled' }),
    onUpdateStatus: () => () => undefined,
    checkForUpdates,
  } as unknown as DesktopApi

  render(<UpdateControls />)
  expect(await screen.findByText(/build has no update feed/)).toBeInTheDocument()
  const check = screen.getByRole('button', { name: 'Check for updates' })
  expect(check).toBeEnabled()
  fireEvent.click(check)
  expect(checkForUpdates).toHaveBeenCalledOnce()
})
