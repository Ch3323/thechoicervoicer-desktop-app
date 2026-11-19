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
