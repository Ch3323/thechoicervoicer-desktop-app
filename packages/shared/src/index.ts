export * from './models'
export * from './pack-parser'
export * from './roles'
export * from './timeline'
export * from './recording-timing'
export * from './preview'
export * from './waveform'
export * from './voice-presets'
export * from './room'

// Planned Google Drive destination remains disabled for the 1.1 release.
export const googleDriveExportsEnabled = false

import type {
  DubPack,
  DubbingProject,
  RecordingTake,
  ExportOptions,
  ExportProgress,
  ExportResult,
  VoiceEffect,
} from './models'
import type { WaveformSnapshot } from './waveform'
import { z } from 'zod'
import type {
  DiscoveredRoom,
  RoomExitReason,
  RoomJoinInfo,
  RoomState,
} from './room'

export interface ImportProgress {
  phase: 'scanning' | 'extracting' | 'saving'
  completedBytes: number
  totalBytes: number
}

export interface OnlinePackListing {
  id: number
  title: string
  submitter?: string
  thumbnailUrl?: string
  hasContentNotice: boolean
  categoryId?: number
}

export interface OnlinePackCategory {
  id: number
  name: string
}

export const ONLINE_PACK_PAGE_SIZE = 48
export const ONLINE_PACK_SEARCH_MAX_LENGTH = 120
export const OnlinePackSearchSchema = z
  .string()
  .trim()
  .max(ONLINE_PACK_SEARCH_MAX_LENGTH)

export const OnlinePackOrderSchema = z.enum([
  'oldest',
  'updated',
  'title-asc',
  'title-desc',
  'most-liked',
  'most-downloaded',
])
export type OnlinePackOrder = z.infer<typeof OnlinePackOrderSchema>

export interface OnlinePackPage {
  packs: OnlinePackListing[]
  hasNextPage: boolean
}

export interface OnlinePackFile {
  id: number
  name: string
  size: number
  canDownload: boolean
  descriptionHtml?: string
  added?: number
  downloads?: number
  scanResult?: string
  archived?: boolean
  hasContents?: boolean
}

export interface OnlinePackArchiveEntry {
  name: string
  children?: OnlinePackArchiveEntry[]
}

export interface OnlinePackDetails extends OnlinePackListing {
  summary?: string
  descriptionHtml?: string
  images: { url: string; caption?: string }[]
  files: OnlinePackFile[]
  visibility?: string
  ratings: string[]
  version?: string
  game?: string
  category?: string
  added?: number
  updated?: number
  obsolete?: boolean
  withholdNotice?: {
    date?: number
    type?: string
    rules: { code?: string; descriptionHtml?: string; fixHtml?: string }[]
  }
  tags: string[]
  credits: { group: string; authors: { name: string; role?: string }[] }[]
  studios: string[]
  mirrors: string[]
  licenseHtml?: string
  permissions: { label: string; terms: string[] }[]
  counts: {
    views?: number
    downloads?: number
    likes?: number
    subscribers?: number
    updates?: number
    comments?: number
    todos?: number
  }
}

export type OnlinePackActivityKind = 'updates' | 'comments' | 'issues' | 'todos'

export interface OnlinePackActivityPage {
  entries: {
    id: number
    title?: string
    author?: string
    added?: number
    bodyHtml?: string
    version?: string
    state?: string
    replyCount?: number
    changes: { category: string; text: string }[]
    files?: string[]
  }[]
  hasNextPage: boolean
}

export interface OnlinePackDownloadProgress {
  packId: number
  fileId: number
  phase: 'preparing' | 'queued' | 'downloading' | 'importing'
  percent?: number
}

export type OnlinePackDownloadEntry = OnlinePackDownloadProgress & {
  name: string
  size: number
} & (
  | { status: 'working'; cancelling?: boolean }
  | { status: 'imported'; title: string }
  | { status: 'saved' | 'cancelled' | 'error' }
)

export interface OnlinePackDownloadsSnapshot {
  revision: number
  downloads: OnlinePackDownloadEntry[]
  completedBytes: number
}

export type OnlinePackDownloadDestination = 'app' | 'device'

export type OnlinePackDownloadResult =
  | { kind: 'imported'; pack: DubPack }
  | { kind: 'saved'; name: string }
  | { kind: 'cancelled' }

export interface PreviewTakeAudio {
  bytes: Uint8Array
  mimeType: string
}

export interface UpdateStatus {
  phase:
    | 'disabled'
    | 'idle'
    | 'checking'
    | 'available'
    | 'downloading'
    | 'downloaded'
    | 'current'
    | 'error'
  version?: string
  percent?: number
  message?: string
  checkedAt?: string
}

export interface DesktopApi {
  getDriveStatus(): Promise<{
    connected: boolean
    folderId?: string
    clientId?: string
  }>
  connectDrive(
    clientId: string,
    folder: string,
  ): Promise<{ connected: boolean; folderId?: string; clientId?: string }>
  disconnectDrive(): Promise<void>
  openDriveExport(url: string): Promise<void>
  getUpdateStatus(): Promise<UpdateStatus>
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void
  checkForUpdates(): Promise<void>
  downloadUpdate(): Promise<void>
  installUpdate(): Promise<void>
  setRecordingActivity(active: boolean): Promise<void>
  createRoom(
    displayName: string,
    port: number,
  ): Promise<{ state: RoomState; playerId: string; address: string }>
  joinRoom(
    address: string,
    code: string,
    displayName: string,
    packId?: string,
    roleIds?: string[],
    rejoining?: boolean,
  ): Promise<{ state: RoomState; playerId: string; address: string }>
  getRoomJoinInfo(
    address: string,
    code: string,
    displayName: string,
  ): Promise<RoomJoinInfo>
  prepareRoomPack(address: string, code: string): Promise<DubPack>
  discoverRooms(): Promise<DiscoveredRoom[]>
  getRoom(): Promise<{
    state: RoomState
    playerId: string
    address: string
  } | null>
  copyRoomDetails(kind: 'code' | 'invite'): Promise<void>
  onRoomState(
    callback: (state: RoomState | null, reason?: RoomExitReason) => void,
  ): () => void
  roomSetPack(packId: string, projectId?: string): Promise<void>
  roomDownloadPack(): Promise<DubPack>
  roomSetVoiceEffect(dialogueId: string, effect: VoiceEffect): Promise<void>
  roomSetTakeGain(takeId: string, gainDb: number): Promise<void>
  roomClaimRole(characterId: string): Promise<void>
  roomReleaseRole(characterId: string): Promise<void>
  roomSetReady(ready: boolean): Promise<void>
  roomStart(): Promise<void>
  roomPromoteMember(playerId: string): Promise<void>
  roomKickMember(playerId: string): Promise<void>
  roomLeave(): Promise<{ historySaved: boolean } | void>
  roomClose(): Promise<void>
  roomGetPreviewUrl(): Promise<string>
  roomGetAssetUrl(assetRef: string): Promise<string>
  roomGetBackingTrackBytes(): Promise<Uint8Array>
  getPreviewTakeAudio(
    mode: 'single' | 'room',
    projectId: string,
    dialogueId: string,
    takeId: string,
    effect?: VoiceEffect,
    gainDb?: number,
  ): Promise<PreviewTakeAudio>
  roomGetTakeUrl(takeId: string): Promise<string>
  roomGetEffectTakeUrl(
    dialogueId: string,
    takeId: string,
    effect: VoiceEffect,
    gainDb?: number,
  ): Promise<string>
  roomRenderPreview(): Promise<string>
  roomCancelRender(): Promise<void>
  onRoomRenderProgress(callback: (progress: ExportProgress) => void): () => void
  roomGetWaveform(dialogueId: string): Promise<WaveformSnapshot | null>
  roomUploadTake(input: {
    dialogueId: string
    mimeType: string
    durationSeconds: number
    offsetSeconds?: number
    bytes: Uint8Array
  }): Promise<RecordingTake>
  roomExport(options: ExportOptions): Promise<ExportResult | null>
  getAppVersion(): Promise<string>
  listPacks(): Promise<DubPack[]>
  browseOnlinePacks(
    page: number,
    categoryId?: number,
    order?: OnlinePackOrder,
    searchTerm?: string,
  ): Promise<OnlinePackPage>
  listOnlinePackCategories(): Promise<OnlinePackCategory[]>
  getOnlinePack(packId: number): Promise<OnlinePackDetails>
  getOnlinePackArchiveContents(
    packId: number,
    fileId: number,
  ): Promise<OnlinePackArchiveEntry[]>
  getOnlinePackActivity(
    packId: number,
    kind: OnlinePackActivityKind,
    page: number,
    parentPostId?: number,
  ): Promise<OnlinePackActivityPage>
  downloadOnlinePack(
    packId: number,
    fileId: number,
    destination: OnlinePackDownloadDestination,
  ): Promise<OnlinePackDownloadResult | null>
  cancelOnlinePackDownload(packId: number, fileId: number): Promise<void>
  getOnlinePackDownloads(): Promise<OnlinePackDownloadsSnapshot>
  clearFinishedOnlinePackDownloads(): Promise<void>
  onOnlinePackDownloadsChanged(
    callback: (snapshot: OnlinePackDownloadsSnapshot) => void,
  ): () => void
  onOnlinePackImported(callback: (pack: DubPack) => void): () => void
  openOnlinePackLink(url: string): Promise<void>
  importPack(): Promise<DubPack | null>
  onImportProgress(callback: (progress: ImportProgress) => void): () => void
  removePack(packId: string): Promise<void>
  listProjects(): Promise<DubbingProject[]>
  createProject(packId: string): Promise<DubbingProject>
  deleteProject(projectId: string): Promise<void>
  updateProjectRoles(
    projectId: string,
    enabledCharacterIds: string[],
  ): Promise<DubbingProject>
  updateVoiceEffect(
    projectId: string,
    dialogueId: string,
    effect: VoiceEffect,
  ): Promise<DubbingProject>
  getPack(packId: string): Promise<DubPack | null>
  getPreviewUrl(packId: string): Promise<string>
  getAssetUrl(packId: string, assetRef: string): Promise<string>
  getBackingTrackBytes(packId: string): Promise<Uint8Array>
  listTakes(projectId: string): Promise<RecordingTake[]>
  saveTake(input: {
    projectId: string
    dialogueId: string
    mimeType: string
    durationSeconds: number
    offsetSeconds?: number
    bytes: Uint8Array
  }): Promise<RecordingTake>
  selectTake(
    projectId: string,
    dialogueId: string,
    takeId: string,
  ): Promise<RecordingTake>
  updateTakeOffset(
    takeId: string,
    offsetSeconds: number,
  ): Promise<RecordingTake>
  updateTakeGain(takeId: string, gainDb: number): Promise<RecordingTake>
  getTakeUrl(takeId: string): Promise<string>
  getEffectTakeUrl(
    projectId: string,
    dialogueId: string,
    takeId: string,
    effect: VoiceEffect,
    gainDb?: number,
  ): Promise<string>
  getWaveform(projectId: string, dialogueId: string): Promise<WaveformSnapshot>
  exportProject(
    projectId: string,
    options: ExportOptions,
  ): Promise<ExportResult | null>
  renderDubPreview(projectId: string, options: ExportOptions): Promise<string>
  cancelExport(projectId: string): Promise<void>
  onExportProgress(callback: (progress: ExportProgress) => void): () => void
  revealExport(projectId: string): Promise<void>
}
