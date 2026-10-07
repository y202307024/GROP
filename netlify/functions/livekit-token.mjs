/**
 * POST /api/livekit-token  본문 { roomName, userName, userId } → { token }
 * Express 의 같은 엔드포인트를 Netlify 함수로 옮긴 것입니다.
 * 필요한 환경변수(Functions 범위): LIVEKIT_API_KEY, LIVEKIT_API_SECRET
 */
import { AccessToken } from 'livekit-server-sdk'
import { json } from '../lib/uploads.mjs'

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST 만 지원합니다' }, 405)
  try {
    const { roomName, userName, userId } = (await req.json().catch(() => ({}))) || {}
    const identity = String(userId || userName || 'guest')

    if (!process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return json({ error: 'LiveKit 서버 설정(LIVEKIT_API_KEY/SECRET)이 없습니다' }, 500)
    }

    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity, name: userName || identity },
    )
    // canUpdateOwnMetadata: 보드 선택 상태를 participant metadata로 공유할 때 필요합니다.
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canUpdateOwnMetadata: true,
    })

    return json({ token: await token.toJwt() })
  } catch (err) {
    console.error('토큰 발급 실패:', err?.message)
    return json({ error: err?.message || '토큰 발급 실패' }, 500)
  }
}

export const config = {
  path: '/api/livekit-token',
}
