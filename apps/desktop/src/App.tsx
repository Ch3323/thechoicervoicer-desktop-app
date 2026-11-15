import { Route, Routes } from 'react-router-dom'
import { HomePage } from '@/pages/HomePage'
import { LibraryPage } from '@/pages/LibraryPage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { ExportPage } from '@/pages/ExportPage'
import { UpdateNotice } from '@/components/UpdateNotice'

export function App() {
  return (
    <><Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/library" element={<LibraryPage />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/workspace/:projectId" element={<WorkspacePage />} />
      <Route path="/export/:projectId" element={<ExportPage />} />
      <Route path="/room" element={<HomePage session="multiplayer" />} />
    </Routes><UpdateNotice /></>
  )
}
