/**
 * Netlify 함수 공용 헬퍼 — 업로드 파일을 Netlify Blobs 에 저장하는 규칙을 한곳에 모읍니다.
 *
 * 저장 구조 (스토어 이름: grop-uploads)
 * - parts/<key>/<index> : 브라우저가 3MiB 씩 나눠 올린 원본 조각
 *     함수 요청 본문 한도(바이너리 약 4.5MB) 때문에 큰 녹화 영상은 한 번에 못 올립니다.
 * - meta/<key>          : 업로드 완료 후 남기는 정보 { key, name, size, mime, parts, partSize, ts }
 *     조각이 다 올라온 뒤에만 쓰므로, meta 가 있으면 "완성된 파일"로 봅니다.
 *
 * key 는 Express 서버의 URL 구조를 그대로 따릅니다.
 * - videos/<groupId>/<날짜>/<타임스탬프>.webm → /videos/... 로 재생
 * - files/<groupId>/<저장파일명>              → /files/... 로 열기
 */
import { getStore } from '@netlify/blobs'

export const UPLOADS_STORE = 'grop-uploads'
export const MEETING_DOCS_STORE = 'grop-meeting-docs'

/** 프론트(src/utils/netlifyUpload.ts)의 조각 크기와 같아야 합니다. */
export const UPLOAD_PART_BYTES = 3 * 1024 * 1024

/** 영상은 Express 와 같이 1GB, 채팅 첨부는 20MB 까지만 받습니다. */
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024
export const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024

/**
 * 업로드 직후 다른 사람이 바로 열어볼 수 있어야 해서 strong consistency 를 씁니다.
 * (기본값 eventual 은 반영까지 최대 60초가 걸릴 수 있습니다.)
 */
export function uploadsStore() {
  return getStore({ name: UPLOADS_STORE, consistency: 'strong' })
}

export function meetingDocsStore() {
  return getStore({ name: MEETING_DOCS_STORE, consistency: 'strong' })
}

export const metaKey = (key) => `meta/${key}`
export const partKey = (key, index) => `parts/${key}/${index}`

/** 폴더명에 .. 나 슬래시가 들어오면 다른 그룹 경로로 새지 못하게 막습니다. (Express 와 같은 규칙) */
export function isSafePathSegment(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('..') && !/[\\/]/.test(value)
}

/**
 * 업로드 key 검증. videos/ 또는 files/ 로 시작하고, 영문·숫자·일부 기호만 허용합니다.
 * 저장 파일명은 프론트에서 한글 없이 만들므로 이 범위로 충분합니다.
 */
export function isValidUploadKey(key) {
  if (typeof key !== 'string' || key.length > 400) return false
  if (key.includes('..') || key.includes('//')) return false
  return /^(videos|files)\/[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)+$/.test(key)
}

/** key → 프론트가 meetings.video_url / 첨부 path 에 저장하는 상대경로 (앞의 videos/·files/ 제거) */
export function relativePathFromKey(key) {
  return key.split('/').slice(1).join('/')
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

/**
 * Express 의 checkUploadToken 과 같은 동작.
 * 환경변수 MEETING_UPLOAD_TOKEN 이 있을 때만 x-upload-token 헤더를 검사합니다.
 * @returns 거절해야 하면 Response, 통과면 null
 */
export function rejectIfBadUploadToken(req) {
  const required = process.env.MEETING_UPLOAD_TOKEN
  if (!required) return null
  if (req.headers.get('x-upload-token') !== required) {
    return json({ error: '업로드 권한이 없습니다' }, 401)
  }
  return null
}

const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

const OTHER_MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.webm': 'video/webm',
}

function fileExtFromName(name) {
  const match = /\.[a-z0-9]{1,8}$/i.exec(String(name || ''))
  return match ? match[0].toLowerCase() : ''
}

/** Windows 에서 한글 파일명은 브라우저가 MIME 을 비워 보내는 경우가 있어 확장자로 보충합니다. */
export function guessMime(name, mime) {
  if (mime && mime !== 'application/octet-stream') return mime
  const ext = fileExtFromName(name)
  return IMAGE_MIME_BY_EXT[ext] || OTHER_MIME_BY_EXT[ext] || mime || 'application/octet-stream'
}
