/**
 * GET /api/chat-files?groupId=<id>
 * 그룹에 올라간 채팅/회의 첨부 목록 (Express 같은 경로와 응답 모양 동일)
 * 문서 탭 「열기」에서 meeting-docs 가 비어 있을 때 폴백으로 씁니다.
 */
import { isSafePathSegment, json, uploadsStore } from '../lib/uploads.mjs'

export default async (req) => {
  const groupId = new URL(req.url).searchParams.get('groupId')
  if (!isSafePathSegment(groupId)) return json({ error: 'groupId 가 필요합니다' }, 400)

  try {
    const store = uploadsStore()
    const prefix = `meta/files/${groupId}/`
    const { blobs } = await store.list({ prefix })
    const metas = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })))

    const files = metas
      .filter((m) => m && typeof m.key === 'string')
      .map((m) => {
        const storedName = m.key.split('/').pop()
        return {
          id: storedName,
          name: m.name || storedName,
          path: `${groupId}/${storedName}`,
          size: Number(m.size) || 0,
          mime: m.mime || 'application/octet-stream',
          ts: Number(m.ts) || 0,
        }
      })
      .sort((a, b) => b.ts - a.ts)

    return json(files)
  } catch (err) {
    console.error('채팅 파일 목록 읽기 실패:', err)
    return json({ error: '파일 목록을 읽지 못했습니다' }, 500)
  }
}

export const config = {
  path: '/api/chat-files',
  method: 'GET',
}
