import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '@studio/shared'

const api: DesktopApi = {
  getDriveStatus: () => ipcRenderer.invoke('drive:status'),
  connectDrive: (clientId, folder) =>
    ipcRenderer.invoke('drive:connect', clientId, folder),
  disconnectDrive: () => ipcRenderer.invoke('drive:disconnect'),
  openDriveExport: (url) => ipcRenderer.invoke('drive:open-export', url),
  getUpdateStatus: () => ipcRenderer.invoke('updates:status'),
  onUpdateStatus: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      status: Parameters<typeof callback>[0],
    ) => callback(status)
    ipcRenderer.on('updates:status', listener)
    return () => ipcRenderer.removeListener('updates:status', listener)
  },
  checkForUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  setRecordingActivity: (active) =>
    ipcRenderer.invoke('updates:recording-activity', active),
  createRoom: (displayName, port) =>
    ipcRenderer.invoke('room:create', displayName, port),
  joinRoom: (address, code, displayName, packId, roleIds, rejoining) =>
    ipcRenderer.invoke(
      'room:join',
      address,
      code,
      displayName,
      packId,
      roleIds,
      rejoining,
    ),
  getRoomJoinInfo: (address, code, displayName) =>
    ipcRenderer.invoke('room:join-info', address, code, displayName),
  prepareRoomPack: (address, code) =>
    ipcRenderer.invoke('room:prepare-pack', address, code),
  discoverRooms: () => ipcRenderer.invoke('room:discover'),
  getRoom: () => ipcRenderer.invoke('room:get'),
  copyRoomDetails: (kind) => ipcRenderer.invoke('room:copy-details', kind),
  onRoomState: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof callback>[0],
      reason: Parameters<typeof callback>[1],
    ) => callback(state, reason)
    ipcRenderer.on('room:state', listener)
    return () => ipcRenderer.removeListener('room:state', listener)
  },
  roomSetPack: (packId, projectId) =>
    ipcRenderer.invoke('room:pack', packId, projectId),
  roomDownloadPack: () => ipcRenderer.invoke('room:download-pack'),
  roomSetVoiceEffect: (dialogueId, effect) =>
    ipcRenderer.invoke('room:voice-effect', dialogueId, effect),
  roomSetTakeGain: (takeId, gainDb) =>
    ipcRenderer.invoke('room:take-gain', takeId, gainDb),
  roomClaimRole: (characterId) => ipcRenderer.invoke('room:claim', characterId),
  roomReleaseRole: (characterId) =>
    ipcRenderer.invoke('room:release', characterId),
  roomSetReady: (ready) => ipcRenderer.invoke('room:ready', ready),
  roomStart: () => ipcRenderer.invoke('room:start'),
  roomPromoteMember: (playerId) => ipcRenderer.invoke('room:promote', playerId),
  roomKickMember: (playerId) => ipcRenderer.invoke('room:kick', playerId),
  roomLeave: () => ipcRenderer.invoke('room:leave'),
  roomClose: () => ipcRenderer.invoke('room:close'),
  roomGetPreviewUrl: () => ipcRenderer.invoke('room:preview'),
  roomGetAssetUrl: (assetRef) => ipcRenderer.invoke('room:asset', assetRef),
  roomGetBackingTrackBytes: () => ipcRenderer.invoke('room:backing-bytes'),
  getPreviewTakeAudio: (mode, projectId, dialogueId, takeId, effect, gainDb) =>
    ipcRenderer.invoke(
      'recordings:preview-audio',
      mode,
      projectId,
      dialogueId,
      takeId,
      effect,
      gainDb,
    ),
  roomGetTakeUrl: (takeId) => ipcRenderer.invoke('room:take-url', takeId),
  roomGetEffectTakeUrl: (dialogueId, takeId, effect, gainDb) =>
    ipcRenderer.invoke(
      'room:effect-take-url',
      dialogueId,
      takeId,
      effect,
      gainDb,
    ),
  roomRenderPreview: () => ipcRenderer.invoke('room:watch'),
  roomCancelRender: () => ipcRenderer.invoke('room:cancel-render'),
  onRoomRenderProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof callback>[0],
    ) => callback(progress)
    ipcRenderer.on('room:render-progress', listener)
    return () => ipcRenderer.removeListener('room:render-progress', listener)
  },
  roomGetWaveform: (dialogueId) =>
    ipcRenderer.invoke('room:waveform', dialogueId),
  roomUploadTake: (input) => ipcRenderer.invoke('room:upload', input),
  roomExport: (options) => ipcRenderer.invoke('room:export', options),
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  listPacks: () => ipcRenderer.invoke('library:list-packs'),
  getPack: (packId) => ipcRenderer.invoke('library:get-pack', packId),
  importPack: () => ipcRenderer.invoke('library:import-pack'),
  onImportProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof callback>[0],
    ) => callback(progress)
    ipcRenderer.on('library:import-progress', listener)
    return () => ipcRenderer.removeListener('library:import-progress', listener)
  },
  removePack: (packId) => ipcRenderer.invoke('library:remove-pack', packId),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (packId) => ipcRenderer.invoke('projects:create', packId),
  deleteProject: (projectId) =>
    ipcRenderer.invoke('projects:delete', projectId),
  updateProjectRoles: (projectId, characterIds) =>
    ipcRenderer.invoke('projects:roles', projectId, characterIds),
  updateVoiceEffect: (projectId, dialogueId, effect) =>
    ipcRenderer.invoke('projects:voice-effect', projectId, dialogueId, effect),
  getPreviewUrl: (packId) => ipcRenderer.invoke('media:preview', packId),
  getAssetUrl: (packId, assetRef) =>
    ipcRenderer.invoke('media:asset', packId, assetRef),
  getBackingTrackBytes: (packId) =>
    ipcRenderer.invoke('media:backing-bytes', packId),
  listTakes: (projectId) => ipcRenderer.invoke('recordings:list', projectId),
  saveTake: (input) => ipcRenderer.invoke('recordings:save', input),
  selectTake: (projectId, dialogueId, takeId) =>
    ipcRenderer.invoke('recordings:select', projectId, dialogueId, takeId),
  updateTakeOffset: (takeId, offsetSeconds) =>
    ipcRenderer.invoke('recordings:offset', takeId, offsetSeconds),
  updateTakeGain: (takeId, gainDb) =>
    ipcRenderer.invoke('recordings:gain', takeId, gainDb),
  getTakeUrl: (takeId) => ipcRenderer.invoke('recordings:url', takeId),
  getEffectTakeUrl: (projectId, dialogueId, takeId, effect, gainDb) =>
    ipcRenderer.invoke(
      'recordings:effect-url',
      projectId,
      dialogueId,
      takeId,
      effect,
      gainDb,
    ),
  getWaveform: (projectId, dialogueId) =>
    ipcRenderer.invoke('media:waveform', projectId, dialogueId),
  exportProject: (projectId, options) =>
    ipcRenderer.invoke('export:start', projectId, options),
  renderDubPreview: (projectId, options) =>
    ipcRenderer.invoke('export:preview', projectId, options),
  cancelExport: (projectId) => ipcRenderer.invoke('export:cancel', projectId),
  onExportProgress: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof callback>[0],
    ) => callback(progress)
    ipcRenderer.on('export:progress', listener)
    return () => ipcRenderer.removeListener('export:progress', listener)
  },
  revealExport: (projectId) => ipcRenderer.invoke('export:reveal', projectId),
}

contextBridge.exposeInMainWorld('studio', api)
