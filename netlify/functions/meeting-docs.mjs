/**
 * 회의 문서(첨부 목록) 저장/조회 — Express 의 /api/meeting-docs* 와 같은 경로·응답 모양
 * - PUT /api/meeting-docs/:meetingId           본문 { groupId, title, date, files }
 * - GET /api/meeting-docs/:meetingId?groupId=  한 회의의 첨부 목록
 * - GET /api/meeting-docs?groupId=             그룹의 회의 문서 목록
 *
 * 저장 key: <groupId>/<meetingId> (스토어 grop-meeting-docs)
 */
import { isSafePathSegment, json, meetingDocsStore, rejectIfBadUploadToken } from '../lib/uploads.mjs'

/** 클라이언트가 보낸 첨부 배열에서 필요한 필드만 남깁니다. (Express 와 같은 정규화) */
function normalizeFiles(files) {
  if (!Array.isArray(files)) return []
  return files
    .filter((f) => f && typeof f.path === 'string' && typeof f.name === 'string')
    .map((f) => ({
      id: typeof f.id === 'string' ? f.id : undefined,
      name: String(f.name),
      path: String(f.path),
      size: typeof f.size === 'number' ? f.size : 0,
      mime: typeof f.mime === 'string' ? f.mime : 'application/octet-stream',
      ts: typeof f.ts === 'number' ? f.ts : Date.now(),
    }))
}

async function putDoc(req, store, meetingId) {
  const denied = rejectIfBadUploadToken(req)
  if (denied) return denied

  const body = await req.json().catch(() => null)
  const groupId = body?.groupId
  if (!isSafePathSegment(meetingId) || !isSafePathSegment(groupId)) {
    return json({ error: '잘못된 회의/그룹 id 입니다' }, 400)
  }

  const payload = {
    id: meetingId,
    groupId,
    title: typeof body?.title === 'string' ? body.title : '',
    date: typeof body?.date === 'string' ? body.date : new Date().toISOString(),
    files: normalizeFiles(body?.files),
    updatedAt: new Date().toISOString(),
  }
  await store.setJSON(`${groupId}/${meetingId}`, payload)
  console.log('회의 문서 첨부 저장:', groupId, meetingId, payload.files.length)
  return json(payload)
}

async function getDoc(store, meetingId, groupId) {
  if (!isSafePathSegment(meetingId)) return json({ error: '잘못된 회의 id 입니다' }, 400)

  if (isSafePathSegment(groupId)) {
    const doc = await store.get(`${groupId}/${meetingId}`, { type: 'json' })
    return doc ? json(doc) : json({ error: '문서 첨부를 찾지 못했습니다' }, 404)
  }

  // groupId 없이 요청하면 모든 그룹에서 이 회의 id 를 찾습니다. (Express 와 같은 동작)
  const { blobs } = await store.list()
  const hit = blobs.find((b) => b.key.endsWith(`/${meetingId}`))
  const doc = hit ? await store.get(hit.key, { type: 'json' }) : null
  return doc ? json(doc) : json({ error: '문서 첨부를 찾지 못했습니다' }, 404)
}

async function listDocs(store, groupId) {
  if (!isSafePathSegment(groupId)) return json({ error: 'groupId 가 필요합니다' }, 400)
  const { blobs } = await store.list({ prefix: `${groupId}/` })
  const docs = (await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' }))))
    .filter((d) => d && d.id)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  return json(docs)
}

export default async (req, context) => {
  try {
    const store = meetingDocsStore()
    const meetingId = context.params.meetingId
    const groupId = new URL(req.url).searchParams.get('groupId')

    if (req.method === 'PUT' && meetingId) return await putDoc(req, store, meetingId)
    if (req.method === 'GET' && meetingId) return await getDoc(store, meetingId, groupId)
    if (req.method === 'GET') return await listDocs(store, groupId)
    return json({ error: '지원하지 않는 요청입니다' }, 405)
  } catch (err) {
    console.error('meeting-docs 처리 실패:', err)
    return json({ error: '회의 문서를 처리하지 못했습니다' }, 500)
  }
}

export const config = {
  path: ['/api/meeting-docs', '/api/meeting-docs/:meetingId'],
}
