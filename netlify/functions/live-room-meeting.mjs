/**
 * POST /api/live-room-meeting  본문 { roomName, meetingId }
 * 진행중 목록이 볼 회의 행을 방에 붙입니다. 이미 붙어 있으면 그 행을 돌려줍니다.
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
  if (req.method !== 'POST') return json({ error: 'POST 만 지원합니다' }, 405)
  const body = (await req.json().catch(() => ({}))) || {}
  const roomName = String(body.roomName || '').trim()
  const meetingId = String(body.meetingId || '').trim()
  if (!roomName || !meetingId) return json({ error: 'roomName과 meetingId가 필요합니다' }, 400)

  const svc = livekitRoomService()
  if (!svc) return json({ error: 'LiveKit 서버 설정이 없습니다' }, 500)
  try {
    const rooms = await svc.listRooms([roomName])
    const current = meetingIdFromMetadata(rooms[0]?.metadata)
    if (current) return json({ meetingId: current })
    await svc.updateRoomMetadata(roomName, JSON.stringify({ meetingId }))
    const after = await svc.listRooms([roomName])
    return json({ meetingId: meetingIdFromMetadata(after[0]?.metadata) || meetingId })
  } catch (err) {
    console.error('회의 행 연결 실패:', err?.message)
    return json({ error: err?.message || '회의 행 연결 실패' }, 500)
  }
}

export const config = {
  path: '/api/live-room-meeting',
}
