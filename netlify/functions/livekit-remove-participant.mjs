/**
 * POST /api/livekit-remove-participant  본문 { roomName, identity }
 * 방장이 멤버를 내보낼 때 LiveKit 방에서 강제 퇴장시킵니다. (Express 와 같은 동작)
 * roomName = 그룹 id, identity = 대상 user id
 */
import { RoomServiceClient } from 'livekit-server-sdk'
import { json } from '../lib/uploads.mjs'

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST 만 지원합니다' }, 405)
  try {
    const body = (await req.json().catch(() => ({}))) || {}
    const roomName = String(body.roomName || '').trim()
    const identity = String(body.identity || '').trim()
    if (!roomName || !identity) {
      return json({ error: 'roomName과 identity가 필요합니다' }, 400)
    }

    const host = process.env.LIVEKIT_URL || process.env.VITE_LIVEKIT_URL || ''
    // wss:// → https:// (RoomService HTTP API)
    const httpHost = host.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:')
    if (!httpHost || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return json({ error: 'LiveKit 서버 설정이 없습니다' }, 500)
    }

    const svc = new RoomServiceClient(httpHost, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET)
    await svc.removeParticipant(roomName, identity)
    return json({ ok: true })
  } catch (err) {
    // 방이 비어 있거나 참가자가 없으면 실패할 수 있음 — 클라이언트는 DB 강퇴만으로도 OK
    console.error('LiveKit 참가자 제거 실패:', err?.message)
    return json({ ok: false, error: err?.message }, 200)
  }
}

export const config = {
  path: '/api/livekit-remove-participant',
}
