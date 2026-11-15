import { Link } from 'react-router-dom'
import { AudioLines, Users } from 'lucide-react'

export function SessionTopBar({
  title,
  roomCode,
  onOpenRoom,
  onLeaveRoom,
  leavingRoom = false,
}: {
  title?: string
  roomCode?: string
  onOpenRoom?: () => void
  onLeaveRoom?: () => void
  leavingRoom?: boolean
}) {
  return (
    <header className="session-topbar">
      <Link
        className="session-topbar-brand"
        to="/"
        aria-label="The Choicer Voicer At Home home"
      >
        <span className="session-topbar-mark">
          <AudioLines aria-hidden="true" />
        </span>
        <span>
          CHOICER <strong>VOICER</strong> STUDIO
        </span>
      </Link>
      <span className="session-topbar-now">
        NOW DUBBING <strong>{title ?? 'Choose a Dub Pack'}</strong>
      </span>
      <nav className="session-topbar-modes" aria-label="Recording session">
        {roomCode && onLeaveRoom && (
          <button
            type="button"
            className="session-leave-room"
            onClick={onLeaveRoom}
            disabled={leavingRoom}
          >
            LEAVE ROOM
          </button>
        )}
        {onOpenRoom ? (
          <button
            type="button"
            className={roomCode ? 'session-in-room' : 'session-multiplayer'}
            onClick={onOpenRoom}
          >
            <Users aria-hidden="true" />{' '}
            {roomCode ? (
              <span>
                IN ROOM<small>{roomCode}</small>
              </span>
            ) : (
              'MULTIPLAYER'
            )}
          </button>
        ) : (
          <Link className="session-multiplayer" to="/room">
            <Users aria-hidden="true" /> MULTIPLAYER
          </Link>
        )}
      </nav>
    </header>
  )
}
