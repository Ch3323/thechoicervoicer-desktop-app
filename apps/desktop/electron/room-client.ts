import { io, type Socket } from 'socket.io-client'
import { networkInterfaces } from 'node:os'
import { z } from 'zod'
import {
  DisplayNameSchema,
  RoomCodeSchema,
  RecordingTakeSchema,
  type RecordingTake,
  type RoomState,
} from '@studio/shared'

function ipv4Octets(address: string): number[] | null {
  const parts = address.split('.').map(Number)
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null
}

export function parseLanAddress(
  input: string,
  localNetworks = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => ({ address: entry.address, netmask: entry.netmask })),
): string {
  const match =
    /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::(\d{2,5}))?$/.exec(
      input.trim(),
    )
  if (!match)
    throw new Error(
      'Enter a LAN IPv4 address and port, for example 192.168.1.5:4318',
    )
  const octets = match.slice(1, 5).map(Number)
  const port = Number(match[5] ?? 4318)
  if (octets.some((part) => part > 255) || port < 1024 || port > 65535)
    throw new Error('Invalid LAN address or port')
  const [a, b] = octets
  const onAttachedSubnet = localNetworks.some((network) => {
    const local = ipv4Octets(network.address)
    const mask = ipv4Octets(network.netmask)
    return Boolean(
      local &&
      mask &&
      mask[0] === 255 &&
      octets.every(
        (part, index) => (part & mask[index]) === (local[index] & mask[index]),
      ),
    )
  })
  if (!(
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    onAttachedSubnet
  ))
    throw new Error('Use a LAN or VPN IPv4 address')
  return `http://${octets.join('.')}:${port}`
}

type Reply<T> = { ok: true; value: T } | { ok: false; error: string }

export class RoomClient {
  private socket: Socket | null = null
  private token: string | null = null
  private state: RoomState | null = null
  private playerId: string | null = null
  private closed = false
  readonly baseUrl: string
  readonly address: string
  code: string
  readonly displayName: string
  private readonly onState: (state: RoomState | null) => void
  private readonly hostSecret?: string
  private readonly packFingerprint?: string
  private readonly roleIds?: string[]

  constructor(
    input: {
      address: string
      code?: string
      displayName: string
      hostSecret?: string
      packFingerprint?: string
      displayAddress?: string
      roleIds?: string[]
    },
    onState: (state: RoomState | null) => void,
  ) {
    this.baseUrl = parseLanAddress(input.address)
    this.address = input.displayAddress ?? input.address
    this.code = input.code
      ? RoomCodeSchema.parse(input.code.trim().toUpperCase())
      : ''
    this.displayName = DisplayNameSchema.parse(input.displayName)
    this.hostSecret = input.hostSecret
    this.packFingerprint = input.packFingerprint
    this.roleIds = input.roleIds
    this.onState = onState
  }

  async connect(): Promise<{
    state: RoomState
    playerId: string
    address: string
  }> {
    if (this.socket) throw new Error('Already connected')
    const socket = io(this.baseUrl, {
      autoConnect: false,
      transports: ['websocket'],
      reconnection: true,
      timeout: 5000,
    })
    this.socket = socket
    socket.on('room:state', (state: RoomState) => {
      this.state = state
      this.onState(state)
    })
    socket.on('room:closed', () => {
      this.closed = true
      this.state = null
      this.onState(null)
      socket.disconnect()
    })
    const join = async () => {
      const result = await this.request<{
        token: string
        playerId: string
        state: RoomState
      }>('room:join', {
        code: this.code || undefined,
        displayName: this.displayName,
        packFingerprint: this.packFingerprint,
        roleIds: this.roleIds,
        ...(this.token
          ? { token: this.token }
          : { hostSecret: this.hostSecret }),
      })
      this.token = z.uuid().parse(result.token)
      this.code = RoomCodeSchema.parse(result.state.code)
      this.playerId = z.uuid().parse(result.playerId)
      this.state = result.state
      this.onState(result.state)
      return {
        state: result.state,
        playerId: result.playerId,
        address: this.address,
      }
    }
    socket.on('connect', () => {
      if (this.token) void join().catch(() => undefined)
    })
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.disconnect()
        reject(new Error('Could not connect to the Host'))
      }, 7000)
      socket.once('connect', () => {
        void join().then(
          (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          (error) => {
            clearTimeout(timer)
            socket.disconnect()
            reject(error)
          },
        )
      })
      socket.once('connect_error', (error) => {
        clearTimeout(timer)
        socket.disconnect()
        reject(error)
      })
      socket.connect()
    })
  }

  getInfo(): { state: RoomState; playerId: string; address: string } | null {
    return this.state && this.playerId
      ? { state: this.state, playerId: this.playerId, address: this.address }
      : null
  }

  async request<T = void>(
    event: string,
    value?: unknown,
    timeoutMs = 10_000,
  ): Promise<T> {
    if (!this.socket || this.closed) throw new Error('Room is closed')
    return new Promise((resolve, reject) => {
      this.socket!.timeout(timeoutMs).emit(
        event,
        value,
        (error: Error | null, reply: Reply<T>) => {
          if (error) reject(new Error('Host did not respond'))
          else if (!reply?.ok)
            reject(new Error(reply?.error ?? 'Room request failed'))
          else resolve(reply.value)
        },
      )
    })
  }

  mediaUrl(path: string): string {
    if (!this.token || !this.state) throw new Error('Join a room first')
    return `${this.baseUrl}${path}?token=${encodeURIComponent(this.token)}`
  }

  async upload(input: {
    dialogueId: string
    mimeType: string
    durationSeconds: number
    offsetSeconds?: number
    bytes: Uint8Array
  }): Promise<RecordingTake> {
    if (!this.token || !this.state) throw new Error('Join a room first')
    const response = await fetch(
      `${this.baseUrl}/upload/${encodeURIComponent(input.dialogueId)}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/octet-stream',
          'x-mime-type': input.mimeType,
          'x-duration-seconds': String(input.durationSeconds),
          'x-offset-seconds': String(input.offsetSeconds ?? 0),
        },
        body: Buffer.from(input.bytes),
      },
    )
    const result: unknown = await response.json()
    if (!response.ok)
      throw new Error(
        z.object({ error: z.string() }).safeParse(result).data?.error ??
          'Upload failed',
      )
    return RecordingTakeSchema.parse(result)
  }

  disconnect(): void {
    this.socket?.disconnect()
    this.socket = null
    this.state = null
    this.onState(null)
  }
}
