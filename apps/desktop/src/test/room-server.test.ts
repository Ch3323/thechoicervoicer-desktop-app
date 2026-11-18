// @vitest-environment node
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { buildAudioTimeline, roomPackForLocalAssets } from '@studio/shared'
import { exportProject } from '../../electron/export'
import { LibraryStore } from '../../electron/library-store'
import { importFolder } from '../../electron/pack-files'
import {
  convertVideoToMp4,
  ffmpegExecutable,
} from '../../electron/preview-proxy'
import { backingPreviewBytes } from '../../electron/backing-preview'
import { RoomClient, parseLanAddress } from '../../electron/room-client'
import { startRoomServer } from '../../electron/room-server'
import { packFingerprint } from '../../electron/pack-fingerprint'
import { discoverRooms } from '../../electron/room-discovery'
import { downloadRoomPack } from '../../electron/room-pack-download'
import { recordingPath } from '../../electron/recordings'
import { roomPreviewTakeAudio } from '../../electron/preview-take'

let root = ''
let stopRoom: (() => Promise<void>) | null = null
const clients: RoomClient[] = []
it('allows discovered VPN subnet addresses without opening unrelated public IPs', () => {
  const networks = [{ address: '26.221.65.160', netmask: '255.0.0.0' }]
  expect(parseLanAddress('26.42.1.5:4318', networks)).toBe(
    'http://26.42.1.5:4318',
  )
  expect(parseLanAddress('100.125.22.20', networks)).toBe(
    'http://100.125.22.20:4318',
  )
  expect(() => parseLanAddress('27.42.1.5:4318', networks)).toThrow(
    'Use a LAN or VPN IPv4 address',
  )
  expect(() => parseLanAddress('8.8.8.8:4318', networks)).toThrow(
    'Use a LAN or VPN IPv4 address',
  )
})
afterEach(async () => {
  for (const client of clients) client.disconnect()
  clients.length = 0
  await stopRoom?.()
  stopRoom = null
  if (root) await rm(root, { recursive: true, force: true })
})

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegExecutable(),
      ['-hide_banner', '-loglevel', 'error', '-y', ...args],
      { windowsHide: true },
    )
    let error = ''
    child.stderr.on('data', (chunk: Buffer) => {
      error += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(error)),
    )
  })
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string')
        return reject(new Error('No port'))
      server.close(() => resolve(address.port))
    })
  })
}

async function eventually(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Room state did not synchronize')
}

it('synchronizes roles and uploads, recovers a session, and exports takes from different players', async () => {
  root = await mkdtemp(join(tmpdir(), 'studio-room-test-'))
  const folder = join(root, 'Scene')
  const userData = join(root, 'user-data')
  const recordingStorage = join(userData, 'recordings')
  const effectStorage = join(userData, 'effect-previews')
  await mkdir(folder)
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=blue:s=160x90:r=10:d=2',
    '-c:v',
    'libtheora',
    '-an',
    join(folder, 'dub_video.ogv'),
  ])
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=220:duration=2',
    '-c:a',
    'aac',
    join(folder, '_backing_track.m4a'),
  ])
  for (const [index, name, frequency] of [
    [1, 'Alice', 440],
    [2, 'Bob', 660],
  ] as const) {
    const ref = `0${index}_${name}.wav`
    await ffmpeg([
      '-f',
      'lavfi',
      '-i',
      `sine=frequency=${frequency}:duration=0.4`,
      '-c:a',
      'pcm_s16le',
      join(folder, ref),
    ])
    await writeFile(
      join(folder, `0${index}_${name}.ini`),
      `[data]\ncaption="${name} line"\ndub_timestamps=[${index === 1 ? 0.3 : 1.1}]\ndub_characters=["${name}"]`,
    )
  }
  const pack = await importFolder(folder)
  expect(pack.backingTrackRef).toBe('_backing_track.m4a')
  const localBacking = await backingPreviewBytes(
    pack,
    join(userData, 'packs'),
    join(userData, 'previews'),
  )
  expect(Buffer.from(localBacking).toString('ascii', 4, 8)).toBe('ftyp')
  const store = new LibraryStore(userData)
  await store.savePack(pack)
  const project = await store.createProject(pack.id)
  const oldTake = {
    id: '00000000-0000-4000-8000-000000000011',
    projectId: project.id,
    dialogueId: pack.dialogues[0].id,
    fileRef: '00000000-0000-4000-8000-000000000011.wav',
    mimeType: 'audio/wav',
    durationSeconds: 0.4,
    offsetSeconds: 0,
    createdAt: new Date().toISOString(),
    selected: true,
  }
  await store.addTake(oldTake)
  const port = await freePort()
  const previewStorage = join(userData, 'previews')
  const server = await startRoomServer({
    store,
    packStorage: join(userData, 'packs'),
    previewStorage,
    recordingStorage,
    effectStorage,
    port,
    createPreview: async (packToPreview) => {
      await mkdir(previewStorage, { recursive: true })
      await convertVideoToMp4(
        join(folder, packToPreview.videoRef),
        join(previewStorage, `${packToPreview.id}.mp4`),
      )
    },
  })
  stopRoom = server.close
  const fingerprint = await packFingerprint(pack, join(userData, 'packs'))
  const makeClient = async (displayName: string, hostSecret?: string) => {
    const client = new RoomClient(
      {
        address: `127.0.0.1:${port}`,
        code: server.code,
        displayName,
        hostSecret,
        packFingerprint: hostSecret ? undefined : fingerprint,
      },
      () => undefined,
    )
    clients.push(client)
    const joined = await client.connect()
    return { client, joined }
  }
  const host = await makeClient('Host', server.hostSecret)
  await mkdir(join(recordingStorage, project.id), { recursive: true })
  await cp(
    join(folder, '01_Alice.wav'),
    recordingPath(recordingStorage, oldTake),
  )
  await host.client.request('room:pack', {
    packId: pack.id,
    projectId: project.id,
  })
  await eventually(
    () => host.client.getInfo()?.state.project?.id === project.id,
  )
  expect(host.client.getInfo()?.state.takes).toEqual([oldTake])
  const emptyProject = await store.createProject(pack.id)
  await expect(
    host.client.request('room:pack', {
      packId: pack.id,
      projectId: emptyProject.id,
    }),
  ).rejects.toThrow('The selected recording has no recorded clips')
  await host.client.request('room:pack', pack.id)
  const rangedPackFile = await fetch(
    `http://127.0.0.1:${port}/pack/file/dub_video.ogv?code=${server.code}`,
    { headers: { Range: 'bytes=0-31' } },
  )
  expect(rangedPackFile.status).toBe(206)
  expect(rangedPackFile.headers.get('content-range')).toMatch(
    /^bytes 0-31\/\d+$/,
  )
  expect(Buffer.from(await rangedPackFile.arrayBuffer())).toEqual(
    (await readFile(join(folder, 'dub_video.ogv'))).subarray(0, 32),
  )
  const nameCheck = await fetch(
    `http://127.0.0.1:${port}/room/join-info?code=${server.code}&name=${encodeURIComponent('  hOsT  ')}`,
  )
  expect(nameCheck.status).toBe(409)
  expect(await nameCheck.json()).toEqual({ error: 'Name already taken' })
  const duplicateHost = new RoomClient(
    {
      address: `127.0.0.1:${port}`,
      code: server.code,
      displayName: '  hOsT  ',
    },
    () => undefined,
  )
  await expect(duplicateHost.connect()).rejects.toThrow('Name already taken')
  duplicateHost.disconnect()
  const availableRole = pack.characters.find((item) => item.name === 'Alice')!
  await host.client.request('room:claim', availableRole.id)
  const hostClaimInfo = (await (
    await fetch(`http://127.0.0.1:${port}/room/join-info?code=${server.code}`)
  ).json()) as { roles: { id: string; available: boolean }[] }
  expect(
    hostClaimInfo.roles.find((role) => role.id === availableRole.id)?.available,
  ).toBe(false)
  await host.client.request('room:release', availableRole.id)
  const joinInfoResponse = await fetch(
    `http://127.0.0.1:${port}/room/join-info?code=${server.code}`,
  )
  expect(joinInfoResponse.ok).toBe(true)
  const joinInfo = (await joinInfoResponse.json()) as {
    roles: { id: string; available: boolean }[]
  }
  expect(
    joinInfo.roles.find((role) => role.id === availableRole.id)?.available,
  ).toBe(true)
  const noPackGuest = new RoomClient(
    {
      address: `127.0.0.1:${port}`,
      code: server.code,
      displayName: 'No pack',
      roleIds: [availableRole.id],
    },
    () => undefined,
  )
  await expect(noPackGuest.connect()).rejects.toThrow('matching Dub Pack')
  noPackGuest.disconnect()
  const roleGuest = new RoomClient(
    {
      address: `127.0.0.1:${port}`,
      code: server.code,
      displayName: 'Role guest',
      roleIds: [availableRole.id],
      packFingerprint: fingerprint,
    },
    () => undefined,
  )
  clients.push(roleGuest)
  const roleJoined = await roleGuest.connect()
  expect(roleJoined.state.assignments[availableRole.id]).toBe(
    roleJoined.playerId,
  )
  const duplicateGuest = new RoomClient(
    {
      address: `127.0.0.1:${port}`,
      code: server.code,
      displayName: 'ROLE GUEST',
    },
    () => undefined,
  )
  await expect(duplicateGuest.connect()).rejects.toThrow('Name already taken')
  duplicateGuest.disconnect()
  const takenInfo = (await (
    await fetch(`http://127.0.0.1:${port}/room/join-info?code=${server.code}`)
  ).json()) as { roles: { id: string; available: boolean }[] }
  expect(
    takenInfo.roles.find((role) => role.id === availableRole.id)?.available,
  ).toBe(false)
  const competingGuest = new RoomClient(
    {
      address: `127.0.0.1:${port}`,
      code: server.code,
      displayName: 'Competing guest',
      roleIds: [availableRole.id],
      packFingerprint: fingerprint,
    },
    () => undefined,
  )
  await expect(competingGuest.connect()).rejects.toThrow('already claimed')
  competingGuest.disconnect()
  await roleGuest.request('room:leave')
  roleGuest.disconnect()
  const reusedName = await makeClient('Role guest')
  await reusedName.client.request('room:leave')
  reusedName.client.disconnect()
  const addressGuest = new RoomClient(
    { address: `127.0.0.1:${port}`, displayName: 'Address guest' },
    () => undefined,
  )
  clients.push(addressGuest)
  await addressGuest.connect()
  expect(addressGuest.code).toBe(server.code)
  await addressGuest.request('room:leave')
  addressGuest.disconnect()
  const disconnectedGuest = await makeClient('Reserved name')
  disconnectedGuest.client.disconnect()
  const duplicateDisconnected = new RoomClient(
    {
      address: `127.0.0.1:${port}`,
      code: server.code,
      displayName: 'reserved name',
    },
    () => undefined,
  )
  await expect(duplicateDisconnected.connect()).rejects.toThrow(
    'Name already taken',
  )
  duplicateDisconnected.disconnect()
  const guestWithoutPack = new RoomClient(
    {
      address: `127.0.0.1:${port}`,
      code: server.code,
      displayName: 'Downloading guest',
    },
    () => undefined,
  )
  clients.push(guestWithoutPack)
  const pendingGuest = await guestWithoutPack.connect()
  expect(
    pendingGuest.state.players.find(
      (player) => player.id === pendingGuest.playerId,
    )?.packReady,
  ).toBe(false)
  await expect(guestWithoutPack.request('room:ready', true)).rejects.toThrow(
    'Download',
  )
  const discovered = (await discoverRooms()).filter((room) =>
    room.address.endsWith(`:${port}`),
  )
  expect(discovered).toHaveLength(1)
  expect(discovered[0].code).toBe(server.code)
  const downloadedRoot = join(root, 'downloaded')
  const downloadedStore = new LibraryStore(downloadedRoot)
  await expect(
    downloadRoomPack(
      `127.0.0.1:${port}`,
      server.code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ',
      join(downloadedRoot, 'packs'),
      downloadedStore,
    ),
  ).rejects.toThrow('Check the room code')
  const downloaded = await downloadRoomPack(
    `127.0.0.1:${port}`,
    server.code,
    join(downloadedRoot, 'packs'),
    downloadedStore,
  )
  expect(downloaded.source.kind).toBe('zip')
  expect(downloaded.backingTrackRef).toBe('_backing_track.m4a')
  expect(await packFingerprint(downloaded, join(downloadedRoot, 'packs'))).toBe(
    fingerprint,
  )
  await guestWithoutPack.request('room:pack-ready', fingerprint)
  expect(
    guestWithoutPack
      .getInfo()
      ?.state.players.find((player) => player.id === pendingGuest.playerId)
      ?.packReady,
  ).toBe(true)
  await guestWithoutPack.request('room:leave')
  guestWithoutPack.disconnect()
  const wrongPack = new RoomClient(
    {
      address: `127.0.0.1:${port}`,
      code: server.code,
      displayName: 'Wrong pack',
      packFingerprint: '0'.repeat(64),
    },
    () => undefined,
  )
  await expect(wrongPack.connect()).rejects.toThrow('does not match')
  wrongPack.disconnect()
  const alice = await makeClient('Alice')
  const bob = await makeClient('Bob')
  expect(host.joined.state.players).toHaveLength(1)
  await expect(bob.client.request('room:pack', pack.id)).rejects.toThrow(
    'Only the Host',
  )
  await eventually(() => bob.client.getInfo()?.state.pack?.id === pack.id)
  const roomProject = bob.client.getInfo()?.state.project
  expect(roomProject?.id).not.toBe(project.id)
  expect(roomProject?.session).toBe('multiplayer')
  expect(bob.client.getInfo()?.state.takes).toEqual([])
  expect(await store.listTakes(project.id)).toEqual([oldTake])
  expect(bob.client.getInfo()?.state.pack?.source.location).toBe('LAN Host')
  const aliceRole = pack.characters.find((item) => item.name === 'Alice')!
  const bobRole = pack.characters.find((item) => item.name === 'Bob')!
  await alice.client.request('room:claim', aliceRole.id)
  await expect(bob.client.request('room:claim', aliceRole.id)).rejects.toThrow(
    'already claimed',
  )
  await bob.client.request('room:claim', bobRole.id)
  await expect(host.client.request('room:start')).rejects.toThrow('ready')
  await host.client.request('room:ready', true)
  await alice.client.request('room:ready', true)
  await bob.client.request('room:ready', true)
  await host.client.request('room:start')
  await eventually(() => bob.client.getInfo()?.state.started === true)
  await eventually(
    () =>
      host.client.getInfo()?.state.assignments[bobRole.id] ===
      bob.joined.playerId,
  )
  const aliceLine = pack.dialogues.find((item) =>
    item.characterIds.includes(aliceRole.id),
  )!
  const bobLine = pack.dialogues.find((item) =>
    item.characterIds.includes(bobRole.id),
  )!
  const aliceBytes = new Uint8Array(
    await readFile(join(folder, aliceLine.sourceRef)),
  )
  const bobBytes = new Uint8Array(
    await readFile(join(folder, bobLine.sourceRef)),
  )
  await expect(
    bob.client.upload({
      dialogueId: aliceLine.id,
      mimeType: 'audio/wav',
      durationSeconds: 0.4,
      bytes: bobBytes,
    }),
  ).rejects.toThrow('do not own')
  await expect(
    alice.client.upload({
      dialogueId: aliceLine.id,
      mimeType: 'audio/wav',
      durationSeconds: 0.4,
      bytes: new Uint8Array([1, 2, 3]),
    }),
  ).rejects.toThrow('format')
  const first = await alice.client.upload({
    dialogueId: aliceLine.id,
    mimeType: 'audio/wav',
    durationSeconds: 0.4,
    bytes: aliceBytes,
  })
  expect(
    buildAudioTimeline(
      pack,
      (await store.getProject(roomProject!.id))!,
      await store.listTakes(roomProject!.id),
    ).missingDialogueIds,
  ).toEqual([bobLine.id])
  const second = await bob.client.upload({
    dialogueId: bobLine.id,
    mimeType: 'audio/wav',
    durationSeconds: 0.4,
    bytes: bobBytes,
  })
  const effect = {
    preset: 'deep' as const,
    pitch: -4,
    tone: -10,
    texture: 0,
    space: 0,
    echo: 0,
    mod: 0,
  }
  await expect(
    bob.client.request('room:voice-effect', {
      dialogueId: aliceLine.id,
      effect,
    }),
  ).rejects.toThrow('do not own')
  await alice.client.request('room:voice-effect', {
    dialogueId: aliceLine.id,
    effect,
  })
  await eventually(
    () =>
      bob.client.getInfo()?.state.project?.voiceEffects?.[aliceLine.id]
        ?.pitch === -4,
  )
  expect(
    (await store.getProject(roomProject!.id))?.voiceEffects?.[aliceLine.id],
  ).toEqual(effect)
  const effected = await fetch(
    alice.client.mediaUrl(
      `/media/effect/${encodeURIComponent(aliceLine.id)}/${first.id}`,
    ),
  )
  expect(effected.status).toBe(200)
  expect(effected.headers.get('content-type')).toContain('audio/mp4')
  expect((await effected.arrayBuffer()).byteLength).toBeGreaterThan(0)
  const roomAudio = await roomPreviewTakeAudio(
    alice.client,
    roomProject!.id,
    aliceLine.id,
    first.id,
    effect,
  )
  expect(roomAudio.mimeType).toBe('audio/mp4')
  expect(roomAudio.bytes.byteLength).toBeGreaterThan(0)
  const originalPreview = new URL(
    alice.client.mediaUrl(
      `/media/effect/${encodeURIComponent(aliceLine.id)}/${first.id}`,
    ),
  )
  originalPreview.searchParams.set(
    'revision',
    JSON.stringify({
      preset: 'original',
      pitch: 0,
      tone: 0,
      texture: 0,
      space: 0,
      echo: 0,
      mod: 0,
    }),
  )
  const original = await fetch(originalPreview)
  expect(original.status).toBe(200)
  expect(original.headers.get('content-type')).toContain('audio/wav')
  expect((await original.arrayBuffer()).byteLength).toBe(aliceBytes.byteLength)
  await eventually(() => host.client.getInfo()?.state.takes.length === 2)
  const waveform = await bob.client.request<{
    original: number[]
    take: number[]
  }>('room:waveform', bobLine.id)
  expect(waveform.original.length).toBeGreaterThan(0)
  expect(waveform.take.length).toBeGreaterThan(0)
  expect(new Set([first.dialogueId, second.dialogueId]).size).toBe(2)
  const media = await fetch(
    alice.client.mediaUrl(`/media/asset/${encodeURIComponent(pack.videoRef)}`),
    { headers: { Range: 'bytes=0-31' } },
  )
  expect(media.status).toBe(206)
  expect((await media.arrayBuffer()).byteLength).toBe(32)
  const suffix = await fetch(
    alice.client.mediaUrl(`/media/asset/${encodeURIComponent(pack.videoRef)}`),
    { headers: { Range: 'bytes=-16' } },
  )
  expect(suffix.status).toBe(206)
  expect((await suffix.arrayBuffer()).byteLength).toBe(16)
  const preview = await fetch(bob.client.mediaUrl('/media/preview'), {
    headers: { Range: 'bytes=0-31' },
  })
  expect(preview.status).toBe(206)
  expect((await preview.arrayBuffer()).byteLength).toBe(32)
  const backing = await fetch(
    bob.client.mediaUrl('/media/asset/_backing_track.m4a'),
    { headers: { Origin: 'http://localhost:5173', Range: 'bytes=0-31' } },
  )
  expect(backing.status).toBe(206)
  expect(backing.headers.get('content-type')).toContain('audio/mp4')
  expect(backing.headers.get('access-control-allow-origin')).toBe('*')
  expect((await backing.arrayBuffer()).byteLength).toBe(32)
  const playableBacking = await fetch(bob.client.mediaUrl('/media/backing'), {
    headers: { Origin: 'http://localhost:5173', Range: 'bytes=0-31' },
  })
  expect(playableBacking.status).toBe(206)
  expect(playableBacking.headers.get('content-type')).toContain('audio/mp4')
  expect(playableBacking.headers.get('access-control-allow-origin')).toBe('*')
  const backingHeader = Buffer.from(await playableBacking.arrayBuffer())
  expect(backingHeader.length).toBe(32)
  expect(backingHeader.toString('ascii', 4, 8)).toBe('ftyp')
  const savedAudio = await fetch(
    bob.client.mediaUrl(`/media/take/${first.id}`),
    {
      headers: { Range: 'bytes=0-15' },
    },
  )
  expect(savedAudio.status).toBe(206)
  expect((await savedAudio.arrayBuffer()).byteLength).toBe(16)
  const unauthorized = await fetch(
    `http://127.0.0.1:${port}/media/take/${first.id}?token=00000000-0000-4000-8000-000000000000`,
  )
  expect(unauthorized.status).toBe(404)
  alice.client['socket']?.io.engine.close()
  await eventually(
    () =>
      host.client
        .getInfo()
        ?.state.players.find((item) => item.id === alice.joined.playerId)
        ?.connected === false,
  )
  await eventually(
    () =>
      host.client
        .getInfo()
        ?.state.players.find((item) => item.id === alice.joined.playerId)
        ?.connected === true,
  )
  expect(alice.client.getInfo()?.playerId).toBe(alice.joined.playerId)
  expect(alice.client.getInfo()?.state.assignments[aliceRole.id]).toBe(
    alice.joined.playerId,
  )
  const persisted = await store.listTakes(roomProject!.id)
  expect(
    buildAudioTimeline(
      pack,
      (await store.getProject(roomProject!.id))!,
      persisted,
    ).missingDialogueIds,
  ).toHaveLength(0)
  const guestFolder = join(root, 'guest', 'Scene')
  await mkdir(join(root, 'guest'))
  await cp(folder, guestFolder, { recursive: true })
  const guestPack = await importFolder(guestFolder)
  expect(guestPack.id).not.toBe(pack.id)
  expect(await packFingerprint(guestPack, join(root, 'guest-packs'))).toBe(
    fingerprint,
  )
  const guestData = join(root, 'guest-data')
  const guestRecordings = join(guestData, 'recordings')
  const guestStore = new LibraryStore(guestData)
  for (const take of persisted.filter((item) => item.selected)) {
    const response = await fetch(bob.client.mediaUrl(`/media/take/${take.id}`))
    expect(response.status).toBe(200)
    const path = recordingPath(guestRecordings, take)
    await mkdir(join(guestRecordings, take.projectId), { recursive: true })
    await writeFile(path, Buffer.from(await response.arrayBuffer()))
  }
  await guestStore.syncRoomSnapshot(
    roomPackForLocalAssets(pack, guestPack),
    { ...roomProject!, packId: guestPack.id },
    persisted,
  )
  const output = join(guestData, 'guest-dub.mp4')
  await exportProject(
    guestStore,
    join(root, 'guest-packs'),
    guestRecordings,
    roomProject!.id,
    { useBackingTrack: false, requireComplete: true, fastMode: true },
    output,
    () => undefined,
  )
  expect((await stat(output)).size).toBeGreaterThan(1000)
  await expect(
    stat(join(previewStorage, `${roomProject!.id}-room-dub.mp4`)),
  ).rejects.toThrow()
  expect(
    (await store.listTakes(roomProject!.id)).filter((take) => take.selected),
  ).toHaveLength(2)
  alice.client.disconnect()
  await eventually(
    () =>
      host.client
        .getInfo()
        ?.state.players.find((item) => item.id === alice.joined.playerId)
        ?.connected === false,
  )
  await host.client.request('room:release', aliceRole.id)
  await bob.client.request('room:claim', aliceRole.id)
  expect(
    (await store.listTakes(roomProject!.id)).find(
      (take) => take.id === first.id,
    ),
  ).toBeTruthy()
  expect(await store.listTakes(project.id)).toEqual([oldTake])
  await host.client.request('room:close')
  await eventually(() => bob.client.getInfo() === null)
}, 60_000)
