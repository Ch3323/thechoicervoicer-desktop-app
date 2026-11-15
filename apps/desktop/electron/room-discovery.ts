import { createSocket } from 'node:dgram'
import { randomUUID } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { z } from 'zod'
import type { DiscoveredRoom } from '@studio/shared'
import { RoomCodeSchema, RoomPortSchema } from '@studio/shared'

const DISCOVERY_PORT = 4319
const Beacon = z.object({
  kind: z.literal('choicer-voicer-room-v1'),
  roomId: z.uuid(),
  port: RoomPortSchema,
  code: RoomCodeSchema,
  title: z.string().max(120),
  players: z.number().int().min(0).max(32),
})

export function announceRoom(
  port: number,
  details: () => { title: string; players: number; code: string },
): () => void {
  const socket = createSocket('udp4')
  const roomId = randomUUID()
  let closed = false
  let ready = false
  socket.bind(0, () => {
    if (closed) return
    ready = true
    socket.setBroadcast(true)
  })
  const announce = () => {
    if (closed || !ready) return
    const payload = Buffer.from(
      JSON.stringify(
        Beacon.parse({
          kind: 'choicer-voicer-room-v1',
          roomId,
          port,
          ...details(),
        }),
      ),
    )
    socket.send(payload, DISCOVERY_PORT, '255.255.255.255', () => undefined)
    socket.send(payload, DISCOVERY_PORT, '127.0.0.1', () => undefined)
  }
  const timer = setInterval(announce, 1000)
  socket.on('error', () => undefined)
  setTimeout(announce, 100)
  return () => {
    closed = true
    clearInterval(timer)
    socket.close()
  }
}

export async function discoverRooms(): Promise<DiscoveredRoom[]> {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  const rooms = new Map<string, DiscoveredRoom>()
  const localAddresses = new Set(
    Object.values(networkInterfaces())
      .flatMap((entries) => entries ?? [])
      .filter((entry) => entry.family === 'IPv4' && !entry.internal)
      .map((entry) => entry.address),
  )
  socket.on('message', (message, remote) => {
    let data: unknown
    try {
      data = JSON.parse(message.toString())
    } catch {
      return
    }
    const parsed = Beacon.safeParse(data)
    if (!parsed.success) return
    const address = `${remote.address}:${parsed.data.port}`
    rooms.set(parsed.data.roomId, {
      address,
      code: parsed.data.code,
      title: parsed.data.title,
      players: parsed.data.players,
    })
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(DISCOVERY_PORT, '0.0.0.0', resolve)
  })
  await new Promise((resolve) => setTimeout(resolve, 1700))
  socket.close()
  const byAddress = new Map<string, DiscoveredRoom>()
  for (const room of rooms.values()) {
    const address = localAddresses.has(room.address.split(':')[0])
      ? `127.0.0.1:${room.address.split(':')[1]}`
      : room.address
    byAddress.set(address, { ...room, address })
  }
  return [...byAddress.values()]
}
