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
  expect(await screen.findByText(/Install a GitHub release to check/)).toBeInTheDocument()
  const check = screen.getByRole('button', { name: 'Check for updates' })
  expect(check).toBeEnabled()
  fireEvent.click(check)
  expect(checkForUpdates).toHaveBeenCalledOnce()
})

it('shows the latest-check result and time when the installed version is current', async () => {
  window.studio = {
    getUpdateStatus: async () => ({ phase: 'current', checkedAt: new Date().toISOString() }),
    onUpdateStatus: () => () => undefined,
    checkForUpdates: async () => undefined,
  } as unknown as DesktopApi

  render(<UpdateControls />)
  expect(await screen.findByText("You're up to date")).toBeInTheDocument()
  expect(screen.getByText(/Last checked: Today,/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Check for updates' })).toBeEnabled()
  expect(screen.queryByRole('button', { name: 'Download update' })).toBeNull()
})
