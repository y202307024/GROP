/**
 * GET /api/live-rooms
 * 사람이 남아 있는 LiveKit 방과, 그 방이 가리키는 회의 행, 참가자 id를 돌려줍니다.
 */
import { RoomServiceClient } from 'livekit-server-sdk'
import { json } from '../lib/uploads.mjs'

function livekitRoomService() {
  const host = process.env.LIVEKIT_URL || process.env.VITE_LIVEKIT_URL || ''
  const httpHost = host.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:')
  if (!httpHost || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) return null
  return new RoomServiceClient(httpHost, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET)
}

function meetingIdFromMetadata(metadata) {
  try {
    const parsed = JSON.parse(metadata || '')
    return typeof parsed?.meetingId === 'string' ? parsed.meetingId : null
  } catch {
    return null
  }
}

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'GET 만 지원합니다' }, 405)
  const svc = livekitRoomService()
  if (!svc) return json({ error: 'LiveKit 서버 설정이 없습니다' }, 500)
  try {
    const rooms = await svc.listRooms()
    const active = []
    for (const room of rooms) {
      if (Number(room.numParticipants) <= 0) continue
      let identities = []
      try {
        const people = await svc.listParticipants(room.name)
        identities = people.map((person) => person.identity).filter(Boolean)
      } catch (err) {
        console.warn('참가자 목록 조회 실패:', room.name, err?.message)
      }
      active.push({
        name: room.name,
        meetingId: meetingIdFromMetadata(room.metadata),
        identities,
      })
    }
    return json({ rooms: active })
  } catch (err) {
    console.error('진행중 방 조회 실패:', err?.message)
    return json({ error: err?.message || '진행중 방 조회 실패' }, 500)
  }
}

export const config = {
  path: '/api/live-rooms',
}
