import { AudioLines, Box, Compass, House, Settings2 } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const destinations = [
  {
    section: 'packs',
    menu: 'Packs menu',
    Icon: Box,
  },
  {
    section: 'recordings',
    menu: 'Recordings menu',
    Icon: AudioLines,
  },
  {
    section: 'settings',
    menu: 'Settings menu',
    Icon: Settings2,
  },
] as const

export type StudioSidebarSection = (typeof destinations)[number]['section']
export type StudioSidebarContext = {
  openSidebar: (section: StudioSidebarSection) => void
}

export function StudioSidebar({
  panels,
  sessionLayout,
}: {
  panels: {
    active: StudioSidebarSection | null
    onToggle: (section: StudioSidebarSection) => void
  }
  sessionLayout: boolean
}) {
  return (
    <nav
      className={
        sessionLayout
          ? 'studio-sidebar studio-sidebar--session'
          : 'studio-sidebar'
      }
      aria-label="Studio navigation"
    >
      <NavLink to="/" end aria-label="Home" title="Home">
        <House aria-hidden="true" />
      </NavLink>
      {destinations.map(({ section, menu, Icon }) => (
        <button
          key={section}
          type="button"
          aria-label={menu}
          title={menu}
          aria-expanded={panels.active === section}
          onClick={() => panels.onToggle(section)}
        >
          <Icon aria-hidden="true" />
        </button>
      ))}
      <NavLink
        to="/browse"
        className="studio-sidebar-browse"
        aria-label="Browse packs"
        title="Browse packs"
      >
        <Compass aria-hidden="true" />
      </NavLink>
    </nav>
  )
}
