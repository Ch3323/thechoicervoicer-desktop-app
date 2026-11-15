import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { SessionTopBar } from './SessionTopBar'

describe('SessionTopBar', () => {
  it('opens the room modal and leaves from the navbar', () => {
    const openRoom = vi.fn()
    const leaveRoom = vi.fn()
    render(
      <MemoryRouter>
        <SessionTopBar
          roomCode="ABC234"
          onOpenRoom={openRoom}
          onLeaveRoom={leaveRoom}
        />
      </MemoryRouter>,
    )

    expect(screen.queryByText('SINGLE PLAYER')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /IN ROOM/ }))
    fireEvent.click(screen.getByRole('button', { name: 'LEAVE ROOM' }))
    expect(openRoom).toHaveBeenCalledOnce()
    expect(leaveRoom).toHaveBeenCalledOnce()
  })
})
