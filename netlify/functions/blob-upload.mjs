/**
 * 브라우저 → Netlify Blobs 조각 업로드 (Express 의 /api/meetings/upload, /api/chat-files/upload 대체)
 *
 * 1) POST /api/blob-upload/part?key=<key>&index=<n>   본문: 조각 바이너리
 * 2) POST /api/blob-upload/complete                   본문: { key, parts, size, mime, name }
 *    → 응답 { path, name, size, mime } 은 Express 업로드 응답과 같은 모양입니다.
 *
 * 함수 요청 본문 한도(바이너리 약 4.5MB) 때문에 한 번에 올리지 않고 조각으로 나눕니다.
 */
import {
  MAX_CHAT_FILE_BYTES,
  MAX_VIDEO_BYTES,
  UPLOAD_PART_BYTES,
  guessMime,
  isValidUploadKey,
  json,
  metaKey,
  partKey,
  rejectIfBadUploadToken,
  relativePathFromKey,
  uploadsStore,
} from '../lib/uploads.mjs'

/** 이미 완성된 파일(meta 존재)은 덮어쓰지 못하게 합니다. 남의 녹화본을 바꿔치기하는 것 방지. */
async function isAlreadyCompleted(store, key) {
  return Boolean(await store.getMetadata(metaKey(key)))
}

async function handlePart(req, store) {
  const url = new URL(req.url)
  const key = url.searchParams.get('key') || ''
  const index = Number(url.searchParams.get('index'))
  if (!isValidUploadKey(key)) return json({ error: '잘못된 업로드 경로입니다' }, 400)
  if (!Number.isInteger(index) || index < 0 || index > 10000) {
    return json({ error: '잘못된 조각 번호입니다' }, 400)
  }
  if (await isAlreadyCompleted(store, key)) {
    return json({ error: '이미 업로드가 끝난 파일입니다' }, 409)
  }

  const body = await req.arrayBuffer()
  if (body.byteLength > UPLOAD_PART_BYTES) {
    return json({ error: '조각이 너무 큽니다' }, 413)
  }

  await store.set(partKey(key, index), body)
  return json({ ok: true, index, size: body.byteLength })
}

async function handleComplete(req, store) {
  const body = await req.json().catch(() => null)
  const key = body?.key
  const parts = Number(body?.parts)
  const size = Number(body?.size)
  if (!isValidUploadKey(key)) return json({ error: '잘못된 업로드 경로입니다' }, 400)
  if (!Number.isInteger(parts) || parts < 1 || !Number.isFinite(size) || size < 0) {
    return json({ error: '조각 정보가 올바르지 않습니다' }, 400)
  }

  const limit = key.startsWith('files/') ? MAX_CHAT_FILE_BYTES : MAX_VIDEO_BYTES
  if (size > limit) {
    return json({ error: key.startsWith('files/') ? '파일은 20MB 이하만 첨부할 수 있어요.' : '녹화본이 너무 큽니다 (1GB 초과)' }, 413)
  }
  if (await isAlreadyCompleted(store, key)) {
    return json({ error: '이미 업로드가 끝난 파일입니다' }, 409)
  }

  // 조각이 하나라도 빠지면 재생 중간이 끊기므로, 전부 있는지 확인한 뒤에만 meta 를 씁니다.
  const checks = await Promise.all(
    Array.from({ length: parts }, (_, i) => store.getMetadata(partKey(key, i))),
  )
  const missing = checks.findIndex((m) => !m)
  if (missing >= 0) {
    return json({ error: `${missing + 1}번째 조각이 올라오지 않았습니다. 다시 업로드해 주세요.` }, 400)
  }

  const name = typeof body?.name === 'string' && body.name.trim() ? body.name.trim() : key.split('/').pop()
  const mime = guessMime(name, typeof body?.mime === 'string' ? body.mime : '')
  const meta = {
    key,
    name,
    size,
    mime,
    parts,
    partSize: UPLOAD_PART_BYTES,
    ts: Date.now(),
  }
  await store.setJSON(metaKey(key), meta)

  console.log('Blobs 업로드 완료:', key, size)
  return json({ path: relativePathFromKey(key), name, size, mime })
}

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'POST 만 지원합니다' }, 405)
  const denied = rejectIfBadUploadToken(req)
  if (denied) return denied

  try {
    const store = uploadsStore()
    if (context.params.action === 'part') return await handlePart(req, store)
    if (context.params.action === 'complete') return await handleComplete(req, store)
    return json({ error: '알 수 없는 업로드 요청입니다' }, 404)
  } catch (err) {
    console.error('Blobs 업로드 실패:', err)
    return json({ error: err?.message || '업로드에 실패했습니다' }, 500)
  }
}

export const config = {
  path: '/api/blob-upload/:action',
}
