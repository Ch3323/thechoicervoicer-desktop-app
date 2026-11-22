import { randomBytes, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import Fastify from 'fastify'
import { Server as SocketServer, type Socket } from 'socket.io'
import {
  canRecordDialogue,
  isPackFileName,
  DisplayNameSchema,
  RoomJoinInfoSchema,
  RoomCodeSchema,
  RoomPortSchema,
  VoiceEffectSchema,
  type DubPack,
  type RoomState,
} from '@studio/shared'
import { z } from 'zod'
import { LibraryStore } from './library-store'
import { packAssetFolder } from './pack-files'
import { recordingPath, saveRecording } from './recordings'
import { ffmpegExecutable } from './preview-proxy'
import { ensureBackingPreview } from './backing-preview'
import { getDialogueWaveform } from './waveform'
import { effectTakeUrl } from './effect-preview'
import { packFingerprint } from './pack-fingerprint'
import { announceRoom } from './room-discovery'

const MAX_UPLOAD = 100 * 1024 * 1024
const MAX_PACK_BYTES = 8 * 1024 * 1024 * 1024
const IdSchema = z.string().min(1).max(1024)
const roomNameKey = (name: string) =>
  name.normalize('NFKC').replace(/\s+/g, ' ').toLowerCase()
const UploadHeaders = z.object({
  'x-mime-type': z.string().min(1).max(128),
  'x-duration-seconds': z.coerce.number().finite().nonnegative().max(3600),
  'x-offset-seconds': z.coerce
    .number()
    .finite()
    .min(-3600)
    .max(3600)
    .optional(),
})

function validateDecodableAudio(bytes: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegExecutable(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        'pipe:0',
        '-map',
        '0:a:0',
        '-t',
        '0.1',
        '-f',
        'null',
        '-',
      ],
      { windowsHide: true },
    )
    let error = ''
    const timer = setTimeout(() => child.kill(), 15_000)
    child.stderr.on('data', (chunk: Buffer) => {
      error = (error + chunk.toString()).slice(-2000)
    })
    child.once('error', (reason) => {
      clearTimeout(timer)
      reject(reason)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(error || 'Recording audio could not be decoded'))
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(bytes)
  })
}

interface Session {
  token: string
  playerId: string
  socketId: string | null
}

export interface RoomServerOptions {
  store: LibraryStore
  packStorage: string
  previewStorage: string
  recordingStorage: string
  effectStorage: string
  port: number
  createPreview: (pack: DubPack) => Promise<void>
  onClosed?: () => void
}

export async function startRoomServer(options: RoomServerOptions) {
  const fastify = Fastify({ logger: false, bodyLimit: MAX_UPLOAD })
  fastify.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: MAX_UPLOAD },
    (_request, body, done) => done(null, body),
  )
  const io = new SocketServer(fastify.server, {
    maxHttpBufferSize: 32 * 1024,
    cors: { origin: false },
  })
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const code = RoomCodeSchema.parse(
    [...randomBytes(6)]
      .map((value) => alphabet[value % alphabet.length])
      .join(''),
  )
  const hostSecret = randomUUID()
  const sessions = new Map<string, Session>()
  const recordingWrites = new Set<Promise<unknown>>()
  let closed = false
  let closingRequested = false
  let closing: Promise<void> | undefined
  const state: RoomState = {
    code,
    hostPlayerId: '',
    players: [],
    assignments: {},
    dialogueOwners: {},
    pack: null,
    project: null,
    takes: [],
    exportProgress: null,
    exportComplete: false,
    readyPlayerIds: [],
    started: false,
  }

  const broadcast = () => io.to('members').emit('room:state', state)
  const sessionFor = (socket: Socket): Session => {
    const token = socket.data.token as string | undefined
    const session = token && sessions.get(token)
    if (closingRequested || closed || !session || session.socketId !== socket.id)
      throw new Error('Join the room first')
    return session
  }
  const hostFor = (socket: Socket): Session => {
    const session = sessionFor(socket)
    if (session.playerId !== state.hostPlayerId)
      throw new Error('Only the Host can do this')
    return session
  }
  const removeMember = (session: Session) => {
    sessions.delete(session.token)
    state.players = state.players.filter((item) => item.id !== session.playerId)
    state.readyPlayerIds = state.readyPlayerIds.filter(
      (id) => id !== session.playerId,
    )
    for (const [role, owner] of Object.entries(state.assignments))
      if (owner === session.playerId) delete state.assignments[role]
    for (const [dialogueId, owner] of Object.entries(state.dialogueOwners))
      if (owner === session.playerId) delete state.dialogueOwners[dialogueId]
  }
  const ackAction = <T>(
    socket: Socket,
    event: string,
    action: (value: unknown) => Promise<T> | T,
  ) => {
    socket.on(
      event,
      (
        value: unknown,
        reply: (
          result: { ok: true; value: T } | { ok: false; error: string },
        ) => void,
      ) => {
        void Promise.resolve()
          .then(() => action(value))
          .then(
            (result) => reply({ ok: true, value: result }),
            (error: unknown) =>
              reply({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
          )
      },
    )
  }

  io.on('connection', (socket) => {
    ackAction(socket, 'room:join', (raw) => {
      const input = z
        .object({
          code: RoomCodeSchema.optional(),
          displayName: DisplayNameSchema,
          token: z.string().uuid().optional(),
          hostSecret: z.string().uuid().optional(),
          packFingerprint: z
            .string()
            .regex(/^[0-9a-f]{64}$/)
            .optional(),
          roleIds: z.array(IdSchema).max(64).optional(),
        })
        .parse(raw)
      if (closingRequested || closed || (input.code && input.code !== code))
        throw new Error('Room not found')
      if (socket.data.token) throw new Error('Already joined this room')
      let session = input.token ? sessions.get(input.token) : undefined
      if (input.token && !session) throw new Error('Room session has expired')
      if (!session) {
        if (state.players.length >= 32) throw new Error('Room is full')
        const isHost = input.hostSecret === hostSecret && !state.hostPlayerId
        if (!isHost && !state.hostPlayerId) throw new Error('Host is not ready')
        if (!isHost && !state.packFingerprint)
          throw new Error('Wait for the Host to choose a Dub Pack')
        if (
          !isHost &&
          input.packFingerprint &&
          input.packFingerprint !== state.packFingerprint
        )
          throw new Error('Local Dub Pack does not match the Host pack')
        if (input.hostSecret && !isHost)
          throw new Error('Invalid Host credential')
        const normalizedName = roomNameKey(input.displayName)
        if (
          state.players.some(
            (player) => roomNameKey(player.displayName) === normalizedName,
          )
        )
          throw new Error('Name already taken')
        if (!isHost && input.roleIds) {
          if (input.packFingerprint !== state.packFingerprint)
            throw new Error('Download or select the matching Dub Pack first')
          if (
            (!state.started && !input.roleIds.length) ||
            new Set(input.roleIds).size !== input.roleIds.length
          )
            throw new Error('Choose at least one available role')
          for (const roleId of input.roleIds) {
            if (
              !state.pack?.characters.some(
                (character) => character.id === roleId,
              )
            )
              throw new Error('Role is unavailable')
            if (state.assignments[roleId])
              throw new Error('Role already claimed')
          }
        }
        const playerId = randomUUID()
        session = { token: randomUUID(), playerId, socketId: null }
        sessions.set(session.token, session)
        state.players.push({
          id: playerId,
          displayName: input.displayName,
          connected: true,
          isHost,
          packReady: isHost || input.packFingerprint === state.packFingerprint,
        })
        if (isHost) state.hostPlayerId = playerId
        for (const roleId of input.roleIds ?? [])
          state.assignments[roleId] = playerId
      }
      const previousSocket = session.socketId
      session.socketId = socket.id
      socket.data.token = session.token
      const player = state.players.find((item) => item.id === session.playerId)!
      player.connected = true
      if (input.packFingerprint)
        player.packReady = input.packFingerprint === state.packFingerprint
      if (previousSocket)
        io.sockets.sockets.get(previousSocket)?.disconnect(true)
      void socket.join('members')
      broadcast()
      return { token: session.token, playerId: session.playerId, state }
    })
    ackAction(socket, 'room:pack-ready', (raw) => {
      const { playerId } = sessionFor(socket)
      const fingerprint = z
        .string()
        .regex(/^[0-9a-f]{64}$/)
        .parse(raw)
      if (!state.packFingerprint || fingerprint !== state.packFingerprint)
        throw new Error('Downloaded Dub Pack does not match the Host pack')
      const player = state.players.find((item) => item.id === playerId)
      if (!player) throw new Error('Player is unavailable')
      player.packReady = true
      broadcast()
    })
    ackAction(socket, 'room:pack', async (raw) => {
      hostFor(socket)
      if (state.started)
        throw new Error('Close this room before changing the pack')
      if (state.players.some((player) => !player.isHost))
        throw new Error('Guests must leave before changing the pack')
      const { packId, projectId } = z
        .object({
          packId: z.string().regex(/^[0-9a-f]{24}$/),
          projectId: z.uuid().optional(),
        })
        .parse(typeof raw === 'string' ? { packId: raw } : raw)
      const pack = await options.store.getPack(packId)
      if (!pack) throw new Error('Host pack not found')
      const roomProject = projectId
        ? await options.store.getProject(projectId)
        : await options.store.createProject(pack.id, 'multiplayer')
      if (!roomProject || roomProject.packId !== pack.id)
        throw new Error('Recording does not belong to the selected Dub Pack')
      const takes = await options.store.listTakes(roomProject.id)
      if (projectId && !takes.some((take) => take.selected))
        throw new Error('The selected recording has no recorded clips')
      for (const take of takes.filter((item) => item.selected)) {
        try {
          await stat(recordingPath(options.recordingStorage, take))
        } catch {
          throw new Error('A selected recording file is missing')
        }
      }
      const fingerprint = await packFingerprint(pack, options.packStorage)
      const project = await options.store.updateRoles(
        roomProject.id,
        pack.characters.map((item) => item.id),
      )
      hostFor(socket)
      if (state.started || state.players.some((player) => !player.isHost))
        throw new Error('Room changed while preparing the pack')
      state.project = { ...project, lastExportPath: undefined }
      state.pack = { ...pack, source: { ...pack.source, location: 'LAN Host' } }
      state.packFingerprint = fingerprint
      state.takes = takes
      state.assignments = {}
      state.dialogueOwners = {}
      state.exportProgress = null
      state.exportComplete = false
      state.readyPlayerIds = []
      state.started = false
      broadcast()
    })
    ackAction(socket, 'room:voice-effect', async (raw) => {
      const { playerId } = sessionFor(socket)
      const { dialogueId, effect } = z
        .object({
          dialogueId: IdSchema,
          effect: VoiceEffectSchema,
        })
        .parse(raw)
      if (
        !state.started ||
        !state.project ||
        !canRecordDialogue(state, playerId, dialogueId)
      )
        throw new Error('You do not own this dialogue')
      state.project = await options.store.updateVoiceEffect(
        state.project.id,
        dialogueId,
        effect,
      )
      state.exportComplete = false
      state.exportProgress = null
      broadcast()
    })
    ackAction(socket, 'room:take-gain', async (raw) => {
      const { playerId } = sessionFor(socket)
      const { takeId, gainDb } = z
        .object({
          takeId: z.uuid(),
          gainDb: z.number().finite().min(-24).max(24),
        })
        .parse(raw)
      const take = state.takes.find(
        (item) => item.id === takeId && item.selected,
      )
      if (
        !state.started ||
        !state.project ||
        !take ||
        take.projectId !== state.project.id ||
        !canRecordDialogue(state, playerId, take.dialogueId)
      )
        throw new Error('You do not own this recording')
      await options.store.updateTakeGain(takeId, gainDb)
      state.takes = await options.store.listTakes(state.project.id)
      state.exportComplete = false
      state.exportProgress = null
      broadcast()
    })
    ackAction(socket, 'room:claim', (raw) => {
      const { playerId } = sessionFor(socket)
      const characterId = IdSchema.parse(raw)
      if (!state.pack?.characters.some((item) => item.id === characterId))
        throw new Error('Character is unavailable')
      const owner = state.assignments[characterId]
      if (owner && owner !== playerId) throw new Error('Role already claimed')
      state.assignments[characterId] = playerId
      state.readyPlayerIds = state.readyPlayerIds.filter(
        (id) => id !== playerId,
      )
      broadcast()
    })
    ackAction(socket, 'room:release', (raw) => {
      const { playerId } = sessionFor(socket)
      const characterId = IdSchema.parse(raw)
      const owner = state.assignments[characterId]
      const disconnected =
        state.players.find((item) => item.id === owner)?.connected === false
      if (
        owner !== playerId &&
        !(playerId === state.hostPlayerId && disconnected)
      )
        throw new Error('You do not own this role')
      delete state.assignments[characterId]
      for (const dialogue of state.pack?.dialogues ?? [])
        if (
          dialogue.characterIds.includes(characterId) &&
          state.dialogueOwners[dialogue.id] === owner
        )
          delete state.dialogueOwners[dialogue.id]
      state.readyPlayerIds = state.readyPlayerIds.filter((id) => id !== owner)
      broadcast()
    })
    ackAction(socket, 'room:ready', (raw) => {
      const { playerId } = sessionFor(socket)
      const ready = z.boolean().parse(raw)
      if (!state.pack || !state.project) throw new Error('Choose a pack first')
      if (!state.players.find((player) => player.id === playerId)?.packReady)
        throw new Error('Download the room Dub Pack first')
      if (
        playerId !== state.hostPlayerId &&
        !Object.values(state.assignments).includes(playerId)
      )
        throw new Error('Choose at least one role first')
      state.readyPlayerIds = state.readyPlayerIds.filter(
        (id) => id !== playerId,
      )
      if (ready) state.readyPlayerIds.push(playerId)
      broadcast()
    })
    ackAction(socket, 'room:start', () => {
      hostFor(socket)
      if (!state.pack || !state.project) throw new Error('Choose a pack first')
      const active = state.players.filter((player) => player.connected)
      if (active.some((player) => !player.packReady))
        throw new Error('Wait for every player to download the pack')
      if (active.some((player) => !state.readyPlayerIds.includes(player.id)))
        throw new Error('Wait for every connected player to be ready')
      state.started = true
      broadcast()
    })
    ackAction(socket, 'room:waveform', (raw) => {
      sessionFor(socket)
      const dialogueId = IdSchema.parse(raw)
      if (
        !state.project ||
        !state.pack?.dialogues.some((dialogue) => dialogue.id === dialogueId)
      )
        throw new Error('Dialogue is unavailable')
      return getDialogueWaveform(
        options.store,
        options.packStorage,
        options.recordingStorage,
        state.project.id,
        dialogueId,
      )
    })
    ackAction(socket, 'room:leave', () => {
      const session = sessionFor(socket)
      if (session.playerId === state.hostPlayerId)
        throw new Error('Host must close the room')
      removeMember(session)
      void socket.leave('members')
      delete socket.data.token
      broadcast()
    })
    ackAction(socket, 'room:promote', (raw) => {
      const host = hostFor(socket)
      const playerId = z.uuid().parse(raw)
      const target = state.players.find((player) => player.id === playerId)
      if (!target?.connected || target.id === host.playerId)
        throw new Error('Choose a connected member to promote')
      if (!target.packReady)
        throw new Error('Wait for the member to download the pack')
      state.hostPlayerId = target.id
      for (const player of state.players) player.isHost = player.id === target.id
      broadcast()
    })
    ackAction(socket, 'room:kick', (raw) => {
      const host = hostFor(socket)
      const playerId = z.uuid().parse(raw)
      const target = [...sessions.values()].find(
        (item) => item.playerId === playerId,
      )
      if (!target || target.playerId === host.playerId)
        throw new Error('Choose a room member to remove')
      removeMember(target)
      const member = target.socketId && io.sockets.sockets.get(target.socketId)
      if (member) {
        member.emit('room:kicked')
        member.disconnect(true)
      }
      broadcast()
    })
    ackAction(socket, 'room:close', () => {
      hostFor(socket)
      closingRequested = true
      setTimeout(() => void close().catch(console.error), 0)
    })
    socket.on('disconnect', () => {
      const token = socket.data.token as string | undefined
      const session = token && sessions.get(token)
      if (!session || session.socketId !== socket.id) return
      session.socketId = null
      const player = state.players.find((item) => item.id === session.playerId)
      if (player) player.connected = false
      broadcast()
    })
  })

  function authorized(raw: unknown): Session {
    const token = z.string().uuid().parse(raw)
    const session = sessions.get(token)
    if (!session || closed) throw new Error('Room session is invalid')
    return session
  }
  const assetRefs = () =>
    new Set(
      [
        state.pack?.videoRef,
        state.pack?.backingTrackRef,
        state.pack?.iconRef,
        ...(state.pack?.dialogues.flatMap((item) => [
          item.sourceRef,
          item.imageRef,
        ]) ?? []),
      ].filter((value): value is string => Boolean(value)),
    )

  async function sendMedia(
    reply: import('fastify').FastifyReply,
    path: string,
    range: string | undefined,
    mime: string,
    packDownload = false,
  ) {
    const file = await (packDownload ? lstat : stat)(path)
    if (!file.isFile()) throw new Error('Media unavailable')
    let start = 0
    let end = file.size - 1
    let status = 200
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range)
      if (!match || (!match[1] && !match[2]))
        return reply
          .code(416)
          .header('Content-Range', `bytes */${file.size}`)
          .send()
      if (match[1]) start = Number(match[1])
      if (match[2]) end = Number(match[2])
      if (!match[1]) {
        start = Math.max(0, file.size - end)
        end = file.size - 1
      } else end = Math.min(end, file.size - 1)
      if (start > end || start >= file.size)
        return reply
          .code(416)
          .header('Content-Range', `bytes */${file.size}`)
          .send()
      status = 206
      reply.header('Content-Range', `bytes ${start}-${end}/${file.size}`)
    }
    reply
      .code(status)
      .header('Accept-Ranges', 'bytes')
      .header('Content-Length', end - start + 1)
      .type(mime)
    return reply.send(
      createReadStream(path, {
        start,
        end,
        highWaterMark: packDownload ? 512 * 1024 : undefined,
      }),
    )
  }
  const MediaQuery = z.object({ token: z.string().uuid() })
  const PackQuery = z.object({ code: RoomCodeSchema })
  fastify.get('/room/join-info', (request, reply) => {
    const query = z
      .object({
        code: RoomCodeSchema.optional(),
        name: DisplayNameSchema.optional(),
      })
      .parse(request.query)
    if (
      closingRequested ||
      closed ||
      (query.code && query.code !== code) ||
      !state.pack
    )
      return reply.code(404).send({ error: 'Room not found' })
    const requestedName = query.name
    const credential = z.uuid().safeParse(
      request.headers.authorization?.replace(/^Bearer /, ''),
    )
    const session = credential.success && sessions.get(credential.data)
    const rejoining = Boolean(
      session &&
      requestedName &&
      state.players.some(
        (player) =>
          player.id === session.playerId &&
          roomNameKey(player.displayName) === roomNameKey(requestedName),
      ),
    )
    if (
      requestedName &&
      !rejoining &&
      state.players.some(
        (player) =>
          roomNameKey(player.displayName) === roomNameKey(requestedName),
      )
    )
      return reply.code(409).send({ error: 'Name already taken' })
    return RoomJoinInfoSchema.parse({
      code,
      fingerprint: state.packFingerprint,
      title: state.pack.metadata.title,
      started: state.started,
      rejoining,
      roles: state.pack.characters.map((character) => ({
        id: character.id,
        name: character.name,
        clips: state.pack!.dialogues.filter((dialogue) =>
          dialogue.characterIds.includes(character.id),
        ).length,
        available: !state.assignments[character.id],
      })),
    })
  })
  const sharedPack = async (rawQuery: unknown) => {
    const query = PackQuery.parse(rawQuery)
    if (
      closed ||
      query.code !== code ||
      !state.project ||
      !state.packFingerprint
    )
      throw new Error('Room pack is unavailable')
    const pack = await options.store.getPack(state.project.packId)
    if (!pack) throw new Error('Room pack is unavailable')
    return { pack, folder: packAssetFolder(pack, options.packStorage) }
  }
  fastify.get('/pack/manifest', async (request, reply) => {
    try {
      const { pack, folder } = await sharedPack(request.query)
      const entries = await readdir(folder, { withFileTypes: true })
      const files = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && isPackFileName(entry.name))
          .map(async (entry) => ({
            name: entry.name,
            size: (await lstat(join(folder, entry.name))).size,
          })),
      )
      if (
        files.length > 10_000 ||
        files.reduce((sum, file) => sum + file.size, 0) > MAX_PACK_BYTES
      )
        throw new Error('Pack is too large to share')
      return {
        fingerprint: state.packFingerprint,
        title: pack.metadata.title,
        files,
      }
    } catch {
      return reply.code(404).send({ error: 'Room pack is unavailable' })
    }
  })
  fastify.get('/pack/file/:name', async (request, reply) => {
    try {
      const { folder } = await sharedPack(request.query)
      const name = z
        .string()
        .refine(isPackFileName)
        .parse((request.params as { name: string }).name)
      const path = join(folder, name)
      return await sendMedia(
        reply,
        path,
        request.headers.range,
        'application/octet-stream',
        true,
      )
    } catch {
      return reply.code(404).send()
    }
  })
  fastify.get('/media/preview', async (request, reply) => {
    try {
      authorized(MediaQuery.parse(request.query).token)
      const pack =
        state.project && (await options.store.getPack(state.project.packId))
      if (!pack) return reply.code(404).send()
      await options.createPreview(pack)
      return sendMedia(
        reply,
        join(options.previewStorage, `${pack.id}.mp4`),
        request.headers.range,
        'video/mp4',
      )
    } catch {
      return reply.code(404).send()
    }
  })
  fastify.get('/media/backing', async (request, reply) => {
    try {
      authorized(MediaQuery.parse(request.query).token)
      const pack =
        state.project && (await options.store.getPack(state.project.packId))
      if (!pack?.backingTrackRef) return reply.code(404).send()
      const path = await ensureBackingPreview(
        pack,
        options.packStorage,
        options.previewStorage,
      )
      reply.header('Access-Control-Allow-Origin', '*')
      return sendMedia(reply, path, request.headers.range, 'audio/mp4')
    } catch {
      return reply.code(404).send()
    }
  })
  fastify.get('/media/asset/:ref', async (request, reply) => {
    try {
      authorized(MediaQuery.parse(request.query).token)
      const ref = IdSchema.parse((request.params as { ref: string }).ref)
      if (!assetRefs().has(ref)) return reply.code(404).send()
      const pack =
        state.project && (await options.store.getPack(state.project.packId))
      if (!pack || !/^[^/\\]+$/.test(ref)) return reply.code(404).send()
      const mime = /\.m4a$/i.test(ref)
        ? 'audio/mp4'
        : /\.mp3$/i.test(ref)
          ? 'audio/mpeg'
          : /\.ogg$/i.test(ref)
            ? 'audio/ogg'
            : /\.wav$/i.test(ref)
              ? 'audio/wav'
              : /\.png$/i.test(ref)
                ? 'image/png'
                : /\.jpe?g$/i.test(ref)
                  ? 'image/jpeg'
                  : /\.ogv$/i.test(ref)
                    ? 'video/ogg'
                    : 'application/octet-stream'
      if (ref === state.pack?.backingTrackRef)
        reply.header('Access-Control-Allow-Origin', '*')
      return sendMedia(
        reply,
        join(packAssetFolder(pack, options.packStorage), ref),
        request.headers.range,
        mime,
      )
    } catch {
      return reply.code(404).send()
    }
  })
  fastify.get('/media/take/:id', async (request, reply) => {
    try {
      authorized(MediaQuery.parse(request.query).token)
      const id = z.uuid().parse((request.params as { id: string }).id)
      const take = await options.store.getTake(id)
      if (!take || take.projectId !== state.project?.id)
        return reply.code(404).send()
      return sendMedia(
        reply,
        recordingPath(options.recordingStorage, take),
        request.headers.range,
        take.mimeType.split(';')[0],
      )
    } catch {
      return reply.code(404).send()
    }
  })
  fastify.get('/media/effect/:dialogueId/:takeId', async (request, reply) => {
    try {
      const query = MediaQuery.extend({
        revision: z.string().max(1024).optional(),
        gainDb: z.coerce.number().finite().min(-24).max(24).optional(),
      }).parse(request.query)
      authorized(query.token)
      const { dialogueId, takeId } = z
        .object({
          dialogueId: IdSchema,
          takeId: z.uuid(),
        })
        .parse(request.params)
      const project = state.project
      const effect = query.revision
        ? VoiceEffectSchema.parse(JSON.parse(query.revision))
        : (project?.voiceEffects?.[dialogueId] ??
          (query.gainDb
            ? {
                preset: 'original' as const,
                pitch: 0,
                tone: 0,
                texture: 0,
                space: 0,
                echo: 0,
                mod: 0,
              }
            : undefined))
      if (
        !project ||
        !effect ||
        !state.pack?.dialogues.some((item) => item.id === dialogueId)
      )
        return reply.code(404).send()
      const url = await effectTakeUrl(
        options.store,
        options.recordingStorage,
        options.effectStorage,
        project.id,
        dialogueId,
        takeId,
        effect,
        query.gainDb ?? 0,
      )
      if (url.startsWith('studio-media://take/')) {
        const take = await options.store.getTake(takeId)
        if (!take) return reply.code(404).send()
        return sendMedia(
          reply,
          recordingPath(options.recordingStorage, take),
          request.headers.range,
          take.mimeType.split(';')[0],
        )
      }
      const filename = url.split('/').at(-1)
      if (!filename || !/^[0-9a-f-]+-[0-9a-f]{16}\.m4a$/.test(filename))
        return reply.code(404).send()
      return sendMedia(
        reply,
        join(options.effectStorage, project.id, filename),
        request.headers.range,
        'audio/mp4',
      )
    } catch {
      return reply.code(404).send()
    }
  })
  fastify.put('/upload/:dialogueId', async (request, reply) => {
    try {
      if (closingRequested)
        return reply.code(409).send({ error: 'The room is closing' })
      const session = authorized(
        request.headers.authorization?.replace(/^Bearer /, ''),
      )
      const dialogueId = IdSchema.parse(
        (request.params as { dialogueId: string }).dialogueId,
      )
      if (!state.started)
        return reply
          .code(403)
          .send({ error: 'Wait for the Host to start the game' })
      if (!canRecordDialogue(state, session.playerId, dialogueId))
        return reply.code(403).send({ error: 'You do not own this dialogue' })
      const metadata = UploadHeaders.parse(request.headers)
      const bytes = request.body
      if (
        !Buffer.isBuffer(bytes) ||
        bytes.length < 1 ||
        bytes.length > MAX_UPLOAD
      )
        return reply.code(400).send({ error: 'Invalid recording size' })
      const mime = metadata['x-mime-type'].split(';')[0].trim().toLowerCase()
      const validAudio =
        mime === 'audio/webm'
          ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
          : mime === 'audio/ogg'
            ? bytes.toString('ascii', 0, 4) === 'OggS'
            : mime === 'audio/mp4'
              ? bytes.toString('ascii', 4, 8) === 'ftyp'
              : ['audio/wav', 'audio/x-wav', 'audio/wave'].includes(mime)
                ? bytes.toString('ascii', 0, 4) === 'RIFF' &&
                  bytes.toString('ascii', 8, 12) === 'WAVE'
                : false
      if (!validAudio)
        return reply
          .code(400)
          .send({ error: 'Recording format does not match its audio data' })
      await validateDecodableAudio(bytes)
      if (closingRequested)
        return reply.code(409).send({ error: 'The room is closing' })
      authorized(session.token)
      if (!canRecordDialogue(state, session.playerId, dialogueId))
        return reply.code(403).send({ error: 'You do not own this dialogue' })
      const projectId = state.project!.id
      const recording = saveRecording(
        options.recordingStorage,
        options.store,
        {
          projectId,
          dialogueId,
          mimeType: metadata['x-mime-type'],
          durationSeconds: metadata['x-duration-seconds'],
          offsetSeconds: metadata['x-offset-seconds'],
          bytes,
        },
      ).then(async (take) => {
        if (
          sessions.has(session.token) &&
          canRecordDialogue(state, session.playerId, dialogueId)
        )
          state.dialogueOwners[dialogueId] = session.playerId
        state.takes = await options.store.listTakes(projectId)
        state.exportComplete = false
        state.exportProgress = null
        broadcast()
        return take
      })
      recordingWrites.add(recording)
      try {
        return reply.send(await recording)
      } finally {
        recordingWrites.delete(recording)
      }
    } catch (error) {
      return reply
        .code(400)
        .send({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  await fastify.listen({
    host: '0.0.0.0',
    port: RoomPortSchema.parse(options.port),
  })
  const stopAnnouncing = announceRoom(options.port, () => ({
    code,
    title: (state.pack?.metadata.title ?? 'Waiting for pack').slice(0, 120),
    players: state.players.filter((player) => player.connected).length,
  }))
  function close() {
    return (closing ??= (async () => {
      stopAnnouncing()
      closingRequested = true
      await Promise.allSettled(recordingWrites)
      // Keep recorded media available until connected guests save their copies.
      await io
        .to('members')
        .timeout(8000)
        .emitWithAck('room:closing')
        .catch(() => undefined)
      closed = true
      io.to('members').emit('room:closed')
      await io.close()
      await fastify.close()
    })().finally(() => options.onClosed?.()))
  }
  return { code, hostSecret, state, close }
}
