import { Route, Routes, useMatch } from 'react-router-dom'
import { HomePage } from '@/pages/HomePage'
import { BrowsePacksPage } from '@/pages/BrowsePacksPage'
import { WorkspacePage } from '@/pages/WorkspacePage'
import { ExportPage } from '@/pages/ExportPage'
import { UpdateNotice } from '@/components/UpdateNotice'
import { ErrorToasts } from '@/components/ErrorToasts'
import { OnlinePackDownloads } from '@/components/OnlinePackDownloads'
import {
  OnlinePackDownloadsContext,
  useOnlinePackDownload,
} from '@/hooks/useOnlinePackDownload'

export function App() {
  const isBrowsing = Boolean(useMatch('/browse/:packId?'))
  const downloads = useOnlinePackDownload()
  return (
    <OnlinePackDownloadsContext value={downloads}>
      <Routes>
        <Route path="/room" element={<HomePage session="multiplayer" />} />
        <Route path="/" element={<HomePage />}>
          <Route path="/browse/:packId?" element={<BrowsePacksPage />} />
          <Route path="/workspace/:projectId" element={<WorkspacePage />} />
          <Route path="/export/:projectId" element={<ExportPage />} />
        </Route>
      </Routes>
      <OnlinePackDownloads manager={downloads} isBrowsing={isBrowsing} />
      <UpdateNotice />
      <ErrorToasts />
    </OnlinePackDownloadsContext>
  )
}
