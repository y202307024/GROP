const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk')
const multer = require('multer')
const fs = require('fs')
const { execFile } = require('child_process')

// node-fetch dynamic import
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))

const os = require('os')
const path = require('path')
const { pipeline } = require('stream/promises')
const { S3Client, DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand } = require('@aws-sdk/client-s3')
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner')
const { startOauthFallback, rememberOauthOrigin, getOauthOrigin } = require('./oauthFallback')
// AI 요약(오디오 추출 → Whisper → LLM) 로직은 Netlify 함수와 함께 쓰려고 별도 모듈로 분리했습니다.
const { getChatModel, getTranscribeModel, summarizeMeeting, summaryErrorMessage } = require('./aiSummary')
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))


// ─────────────────────────────────────────────────────────────
// 회의 녹화 영상
// 새 녹화는 Cloudflare R2에 올리고, 이 디스크 폴더는 예전 /videos 영상용으로 남깁니다.
// Supabase meetings.video_url 에는 이 폴더 기준 상대경로만 저장됩니다.
// ─────────────────────────────────────────────────────────────
const MEETING_VIDEOS_DIR = path.resolve(__dirname, 'uploads', 'meeting-videos')
fs.mkdirSync(MEETING_VIDEOS_DIR, { recursive: true })
// multer가 파일을 먼저 받으면 req.body.groupId 가 비어 destination 이 unknown 이 됩니다.
// 그래서 임시 폴더에 받은 뒤, 필드가 다 파싱된 핸들러에서 최종 폴더로 옮깁니다.
const MEETING_VIDEOS_INCOMING_DIR = path.join(MEETING_VIDEOS_DIR, '_incoming')
fs.mkdirSync(MEETING_VIDEOS_INCOMING_DIR, { recursive: true })

const CHAT_FILES_DIR = path.resolve(__dirname, 'uploads', 'chat-files')
fs.mkdirSync(CHAT_FILES_DIR, { recursive: true })
const CHAT_FILES_INCOMING_DIR = path.join(CHAT_FILES_DIR, '_incoming')
fs.mkdirSync(CHAT_FILES_INCOMING_DIR, { recursive: true })
const MAX_CHAT_FILE_BYTES = 20 * 1024 * 1024

/** 회의 문서(첨부 목록) — DB attachments 컬럼 없이도 문서 탭에서 파일을 보게 합니다. */
const MEETING_DOCS_DIR = path.resolve(__dirname, 'uploads', 'meeting-docs')
fs.mkdirSync(MEETING_DOCS_DIR, { recursive: true })

/** 폴더명에 .. 나 슬래시가 들어오면 디스크 밖으로 나가지 못하게 막습니다. */
function isSafePathSegment(value) {
  return typeof value === 'string' && value.length > 0 && !value.includes('..') && !/[\\/]/.test(value)
}

/** DB video_url 과 실제 저장 폴더가 어긋난 예전 파일은 파일 이름으로 다시 찾습니다. */
function findMeetingVideoByBasename(basename) {
  if (!isSafePathSegment(basename)) return null
  const stack = [MEETING_VIDEOS_DIR]
  while (stack.length > 0) {
    const dir = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      if (ent.name === '_incoming') continue
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) stack.push(full)
      else if (ent.name === basename) return full
    }
  }
  return null
}

/**
 * 프론트가 넘기는 videoUrl(https://localhost:5173/videos/...)에서
 * 디스크 상대경로만 꺼냅니다. Node는 mkcert 인증서를 못 믿어서 HTTPS로 다시 받으면 실패합니다.
 */
function extractVideosRelativePath(videoUrl) {
  const raw = String(videoUrl || '').trim()
  if (!raw) return null
  const marker = '/videos/'
  const idx = raw.indexOf(marker)
  let rel = idx >= 0 ? raw.slice(idx + marker.length).split('?')[0] : raw.replace(/^\/+/, '')
  try {
    rel = decodeURIComponent(rel)
  } catch {
    // 이미 디코드된 경로는 그대로 씁니다.
  }
  rel = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (rel.endsWith('.url.txt')) rel = rel.slice(0, -'.url.txt'.length)
  if (!rel || rel.includes('..')) return null
  return rel
}

/** 이 서버에 저장된 녹화본이면 로컬 파일 경로를 돌려줍니다. */
function resolveMeetingVideoFile(videoUrl) {
  const rel = extractVideosRelativePath(videoUrl)
  if (!rel) return null
  const direct = path.resolve(MEETING_VIDEOS_DIR, rel)
  if (!direct.startsWith(MEETING_VIDEOS_DIR)) return null
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) return direct
  return findMeetingVideoByBasename(path.basename(rel))
}

// 업로드 엔드포인트를 아무나 두드릴 수 없도록 최소한의 토큰 체크를 둡니다.
// .env 에 MEETING_UPLOAD_TOKEN 을 설정하면 활성화되고, 없으면 검사를 생략합니다.
function checkUploadToken(req, res, next) {
  const required = process.env.MEETING_UPLOAD_TOKEN
  if (!required) return next()
  if (req.header('x-upload-token') !== required) {
    return res.status(401).json({ error: '업로드 권한이 없습니다' })
  }
  next()
}

// 브라우저가 R2로 직접 올리는 주소는 15분, 재생 주소는 1시간만 유효합니다.
const R2_PUT_EXPIRES_SEC = 15 * 60
const R2_GET_EXPIRES_SEC = 60 * 60
const MAX_MEETING_VIDEO_BYTES = 1024 * 1024 * 1024

let r2Client = null

/** R2는 S3 호환이라 같은 SDK를 씁니다. 비밀값은 .env에서만 읽습니다. */
function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    const err = new Error(
      'R2 저장소 설정이 없습니다. R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET 을 .env에 넣어 주세요.',
    )
    err.statusCode = 500
    throw err
  }
  if (!r2Client) {
    r2Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
      // 체크섬 헤더까지 서명에 넣으면 브라우저 PUT이 서명 불일치로 거절됩니다.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    })
  }
  return r2Client
}

/**
 * R2 객체 키. meeting-videos/ 로 시작하고 .. 가 없어야 합니다.
 * 통과하면 디코드된 키를, 아니면 null을 돌려줍니다.
 */
function normalizeMeetingVideoKey(raw) {
  if (typeof raw !== 'string') return null
  let key = raw.trim()
  if (!key) return null
  try {
    key = decodeURIComponent(key)
  } catch {
    return null
  }
  if (!key.startsWith('meeting-videos/')) return null
  if (key.includes('..') || key.includes('\\') || key.includes('\0')) return null
  if (key.split('/').some((part) => part.length === 0)) return null
  return key
}

/** 서명에 넣는 Content-Type과 브라우저 PUT 헤더가 같아야 해서, 코덱 꼬리는 떼고 표준 값만 씁니다. */
function meetingUploadContentType(mimeType) {
  const mime = typeof mimeType === 'string' ? mimeType.split(';')[0].trim().toLowerCase() : ''
  if (mime === 'video/webm' || mime === 'audio/webm' || mime === 'video/mp4' || mime === 'audio/mp4') {
    return mime
  }
  return 'video/webm'
}

/** 요약용으로 R2 원본을 임시 파일에 받습니다. 호출한 쪽이 처리 후 지웁니다. */
async function downloadMeetingVideoFromR2(key, destPath) {
  const client = getR2Client()
  let obj
  try {
    obj = await client.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    }))
  } catch (err) {
    throw new Error(`R2에서 영상을 내려받지 못했습니다: ${err.message}`)
  }
  if (!obj.Body) throw new Error('R2에서 영상을 내려받지 못했습니다')
  // 긴 회의도 메모리에 통째로 올리지 않고 파일로 흘려 보냅니다.
  if (typeof obj.Body.pipe === 'function') {
    await pipeline(obj.Body, fs.createWriteStream(destPath))
    return
  }
  if (typeof obj.Body.transformToByteArray === 'function') {
    const bytes = await obj.Body.transformToByteArray()
    fs.writeFileSync(destPath, Buffer.from(bytes))
    return
  }
  throw new Error('R2 응답을 파일로 저장하지 못했습니다')
}

// 최종 폴더(groupId/날짜)는 업로드 핸들러에서 만듭니다. 여기는 임시 수신만.
const uploadMeetingVideo = multer({
  dest: MEETING_VIDEOS_INCOMING_DIR,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB. 필요하면 조정하세요.
})

const uploadChatFile = multer({
  dest: CHAT_FILES_INCOMING_DIR,
  limits: { fileSize: MAX_CHAT_FILE_BYTES },
})

const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
}

/** multer는 파일명을 latin1로 읽어서 한글이 깨집니다. UTF-8로 되돌립니다. */
function decodeMulterOriginalName(name) {
  if (!name || typeof name !== 'string') return 'file'
  if (/[가-힣]/.test(name)) return name
  const utf8 = Buffer.from(name, 'latin1').toString('utf8')
  if (utf8 && !utf8.includes('\uFFFD') && /[가-힣]/.test(utf8)) return utf8
  return name
}

function fileExtFromName(name) {
  const ext = path.extname(String(name || '')).toLowerCase()
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : ''
}

/** 디스크/URL에는 한글을 넣지 않습니다. 프록시에서 이미지가 404 나는 것을 막습니다. */
function storedChatFileName(originalName) {
  const ext = fileExtFromName(originalName)
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`
}

function guessChatFileMime(originalName, mimetype) {
  if (mimetype && mimetype !== 'application/octet-stream') return mimetype
  return IMAGE_MIME_BY_EXT[fileExtFromName(originalName)] || mimetype || 'application/octet-stream'
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
})

app.get('/api/oauth-origin', (req, res) => {
  res.json({ origin: getOauthOrigin() })
})

app.post('/api/oauth-origin', (req, res) => {
  res.json({ origin: rememberOauthOrigin(req.body?.origin) })
})

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

/** 사람이 남아 있는 방. 회의 목록의 진행중/완료와 참석자 아이콘이 이 목록을 봅니다. */
app.get('/api/live-rooms', async (_req, res) => {
  const svc = livekitRoomService()
  if (!svc) return res.status(500).json({ error: 'LiveKit 서버 설정이 없습니다' })
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
        console.warn('참가자 목록 조회 실패:', room.name, err.message)
      }
      active.push({
        name: room.name,
        meetingId: meetingIdFromMetadata(room.metadata),
        identities,
      })
    }
    res.json({ rooms: active })
  } catch (err) {
    console.error('진행중 방 조회 실패:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/** 이 방에 표시할 회의 행을 붙입니다. 이미 있으면 그 행을 그대로 돌려줍니다. */
app.post('/api/live-room-meeting', async (req, res) => {
  const roomName = String(req.body?.roomName || '').trim()
  const meetingId = String(req.body?.meetingId || '').trim()
  if (!roomName || !meetingId) {
    return res.status(400).json({ error: 'roomName과 meetingId가 필요합니다' })
  }
  const svc = livekitRoomService()
  if (!svc) return res.status(500).json({ error: 'LiveKit 서버 설정이 없습니다' })
  try {
    const rooms = await svc.listRooms([roomName])
    const current = meetingIdFromMetadata(rooms[0]?.metadata)
    if (current) return res.json({ meetingId: current })
    await svc.updateRoomMetadata(roomName, JSON.stringify({ meetingId }))
    const after = await svc.listRooms([roomName])
    res.json({ meetingId: meetingIdFromMetadata(after[0]?.metadata) || meetingId })
  } catch (err) {
    console.error('회의 행 연결 실패:', err.message)
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/livekit-token', async (req, res) => {
  try {
    const { roomName, userName, userId } = req.body
    const identity = String(userId || userName || 'guest')
    console.log('토큰 발급 요청:', roomName, identity)

    const token = new AccessToken(
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
      { identity, name: userName || identity }
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

    const jwt = await token.toJwt()
    console.log('토큰 발급 성공!')
    res.json({ token: jwt })
  } catch (err) {
    console.error('토큰 발급 실패:', err.message)
    res.status(500).json({ error: err.message })
  }
})

/**
 * 방장이 멤버를 내보낼 때 LiveKit 방에서 강제 퇴장시킵니다.
 * roomName = 그룹 id, identity = 대상 user id
 */
app.post('/api/livekit-remove-participant', async (req, res) => {
  try {
    const roomName = String(req.body?.roomName || '').trim()
    const identity = String(req.body?.identity || '').trim()
    if (!roomName || !identity) {
      return res.status(400).json({ error: 'roomName과 identity가 필요합니다' })
    }

    const host = process.env.LIVEKIT_URL || process.env.VITE_LIVEKIT_URL || ''
    // wss:// → https:// (RoomService HTTP API)
    const httpHost = host.replace(/^wss:/i, 'https:').replace(/^ws:/i, 'http:')
    if (!httpHost || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(500).json({ error: 'LiveKit 서버 설정이 없습니다' })
    }

    const svc = new RoomServiceClient(
      httpHost,
      process.env.LIVEKIT_API_KEY,
      process.env.LIVEKIT_API_SECRET,
    )
    await svc.removeParticipant(roomName, identity)
    res.json({ ok: true })
  } catch (err) {
    // 방이 비어 있거나 참가자가 없으면 실패할 수 있음 — 클라이언트는 DB 강퇴만으로도 OK
    console.error('LiveKit 참가자 제거 실패:', err.message)
    res.status(200).json({ ok: false, error: err.message })
  }
})

// 예전 직접 업로드용 주소. 브라우저는 더 이상 이 주소로 PUT하지 않고 /api/meetings/upload-r2 로 보냅니다.
app.post('/api/meetings/upload-url', checkUploadToken, async (req, res) => {
  try {
    const groupId = req.body?.groupId
    const dateStr = req.body?.dateStr
    // 예전 디스크 업로드는 잘못된 폴더명을 unknown으로 바꿨지만,
    // 여기서는 그 값이 R2 키로 남으므로 안전한 조각이 아니면 거절합니다.
    if (!isSafePathSegment(groupId) || !isSafePathSegment(dateStr)) {
      return res.status(400).json({ error: 'groupId와 날짜가 올바르지 않습니다' })
    }
    const size = Number(req.body?.size)
    if (!Number.isFinite(size) || size <= 0) {
      return res.status(400).json({ error: '파일 크기가 올바르지 않습니다' })
    }
    if (size > MAX_MEETING_VIDEO_BYTES) {
      return res.status(413).json({ error: '파일이 너무 큽니다. 1GB 이하만 올릴 수 있어요.' })
    }

    const contentType = meetingUploadContentType(req.body?.mimeType)
    const key = `meeting-videos/${groupId}/${dateStr}/${Date.now()}.webm`
    const client = getR2Client()
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      ContentType: contentType,
    })
    const uploadUrl = await getSignedUrl(client, command, { expiresIn: R2_PUT_EXPIRES_SEC })
    console.log('회의 녹화 업로드 주소 발급:', key)
    res.json({ uploadUrl, key, contentType })
  } catch (err) {
    console.error('업로드 주소 발급 실패:', err.message)
    res.status(err.statusCode || 500).json({ error: err.message || '업로드 주소를 만들지 못했습니다' })
  }
})

// 브라우저는 파일을 이 서버로 보냅니다. 서버가 R2에 넣은 뒤 임시 파일은 지웁니다.
// 브라우저가 R2로 직접 PUT하면 Failed to fetch로 끊겨 녹화가 저장되지 않았습니다.
app.post('/api/meetings/upload-r2', checkUploadToken, uploadMeetingVideo.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '업로드된 파일이 없습니다' })
  }

  const groupId = req.body?.groupId
  const dateStr = req.body?.dateStr
  // 키에 그대로 들어가므로 폴더명으로 쓸 수 없는 값은 디스크에 남기지 않고 거절합니다.
  if (!isSafePathSegment(groupId) || !isSafePathSegment(dateStr)) {
    try { fs.unlinkSync(req.file.path) } catch { /* 거절된 임시 파일은 남기지 않습니다 */ }
    return res.status(400).json({ error: 'groupId와 날짜가 올바르지 않습니다' })
  }

  const contentType = meetingUploadContentType(req.body?.mimeType || req.file.mimetype)
  const key = `meeting-videos/${groupId}/${dateStr}/${Date.now()}.webm`
  try {
    const client = getR2Client()
    await client.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: fs.createReadStream(req.file.path),
      ContentType: contentType,
      ContentLength: req.file.size,
    }))
    console.log('회의 녹화 R2 저장 완료:', key)
    res.json({ key, contentType, sizeBytes: req.file.size })
  } catch (err) {
    console.error('서버 경유 R2 업로드 실패:', err.message)
    res.status(err.statusCode || 500).json({ error: err.message || '저장소에 영상을 올리지 못했습니다' })
  } finally {
    try { fs.unlinkSync(req.file.path) } catch { /* 임시 파일 삭제는 실패해도 응답은 이미 끝났습니다 */ }
  }
})

/** 예전 디스크 영상 주소에서 이 서버 폴더 안의 파일만 고릅니다. 폴더 밖은 null입니다. */
function meetingVideoDiskPath(raw) {
  if (typeof raw !== 'string') return null
  let rel = raw.trim()
  if (!rel) return null
  const marker = '/videos/'
  const idx = rel.indexOf(marker)
  if (idx >= 0) {
    try {
      rel = decodeURIComponent(rel.slice(idx + marker.length).split('?')[0] ?? '')
    } catch {
      return null
    }
  }
  rel = rel.replace(/^\/+/, '')
  if (!rel || rel.includes('..') || rel.includes('\\') || rel.includes('\0')) return null
  const full = path.resolve(MEETING_VIDEOS_DIR, rel)
  if (full !== MEETING_VIDEOS_DIR && !full.startsWith(MEETING_VIDEOS_DIR + path.sep)) return null
  return full
}

// 재생용 GET 주소. 키는 meeting-videos/ 아래만 허용합니다.
app.get('/api/meetings/video-url', async (req, res) => {
  try {
    const key = normalizeMeetingVideoKey(typeof req.query.key === 'string' ? req.query.key : '')
    if (!key) return res.status(400).json({ error: '잘못된 영상 키입니다' })
    const client = getR2Client()
    const command = new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    })
    const url = await getSignedUrl(client, command, { expiresIn: R2_GET_EXPIRES_SEC })
    res.json({ url, expiresIn: R2_GET_EXPIRES_SEC })
  } catch (err) {
    console.error('재생 주소 발급 실패:', err.message)
    res.status(err.statusCode || 500).json({ error: err.message || '재생 주소를 만들지 못했습니다' })
  }
})

// 요약 화면의 전체 용량. meeting-videos/ 아래 파일 크기만 모읍니다.
app.get('/api/meetings/storage', checkUploadToken, async (req, res) => {
  try {
    const client = getR2Client()
    let token
    let totalBytes = 0
    const files = []
    do {
      const listed = await client.send(new ListObjectsV2Command({
        Bucket: process.env.R2_BUCKET,
        Prefix: 'meeting-videos/',
        ContinuationToken: token,
      }))
      for (const item of listed.Contents || []) {
        if (!item.Key) continue
        const size = item.Size || 0
        totalBytes += size
        files.push({ key: item.Key, size })
      }
      token = listed.IsTruncated ? listed.NextContinuationToken : undefined
    } while (token)
    res.json({ totalBytes, files })
  } catch (err) {
    console.error('녹화 용량 조회 실패:', err.message)
    res.status(err.statusCode || 500).json({ error: err.message || '용량을 읽지 못했습니다' })
  }
})

// 요약 화면의 삭제. R2 원본과 예전 디스크 파일을 지웁니다. 회의 행은 클라이언트가 비웁니다.
app.delete('/api/meetings/video', checkUploadToken, async (req, res) => {
  const key = normalizeMeetingVideoKey(typeof req.query.key === 'string' ? req.query.key : '')
  const diskPath = meetingVideoDiskPath(typeof req.query.path === 'string' ? req.query.path : '')
  if (!key && !diskPath) return res.status(400).json({ error: '지울 영상이 없습니다' })

  try {
    if (key) {
      const client = getR2Client()
      await client.send(new DeleteObjectCommand({
        Bucket: process.env.R2_BUCKET,
        Key: key,
      }))
      console.log('회의 녹화 R2 삭제:', key)
    }
    if (diskPath && fs.existsSync(diskPath)) {
      fs.unlinkSync(diskPath)
      console.log('회의 녹화 디스크 삭제:', diskPath)
    }
    res.json({ ok: true })
  } catch (err) {
    console.error('회의 녹화 삭제 실패:', err.message)
    res.status(err.statusCode || 500).json({ error: err.message || '영상을 지우지 못했습니다' })
  }
})

// 예전 녹화 호환. 클라이언트(Room.tsx)가 녹화 종료 시 이 엔드포인트로 webm blob 을 보냅니다.
// 저장 위치는 Supabase Storage 가 아니라 이 서버 컴퓨터의 디스크입니다.
app.post('/api/meetings/upload', checkUploadToken, uploadMeetingVideo.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '업로드된 파일이 없습니다' })
  }

  const groupId = isSafePathSegment(req.body.groupId) ? req.body.groupId : 'unknown'
  const dateStr = isSafePathSegment(req.body.dateStr) ? req.body.dateStr : 'unknown-date'
  const ext = (req.file.originalname && req.file.originalname.split('.').pop()) || 'webm'
  const filename = `${Date.now()}.${ext}`
  const destDir = path.join(MEETING_VIDEOS_DIR, groupId, dateStr)

  try {
    fs.mkdirSync(destDir, { recursive: true })
    fs.renameSync(req.file.path, path.join(destDir, filename))
  } catch (err) {
    console.error('녹화본 최종 저장 실패:', err)
    try { fs.unlinkSync(req.file.path) } catch { /* 임시 파일 삭제 실패는 무시 */ }
    return res.status(500).json({ error: '녹화본을 디스크에 저장하지 못했습니다' })
  }

  // 프론트가 이 문자열을 meetings.video_url 에 그대로 넣습니다.
  const relativePath = `${groupId}/${dateStr}/${filename}`
  console.log('회의 녹화본 저장 완료:', relativePath)
  res.json({ path: relativePath })
})

// 저장된 녹화본을 서빙합니다. sendFile 이 Range 를 지원해 <video> seek 이 동작합니다.
app.use('/videos', (req, res, next) => {
  const relPath = decodeURIComponent(String(req.path || '').replace(/^\//, ''))
  if (!relPath) return next()

  const direct = path.resolve(MEETING_VIDEOS_DIR, relPath)
  if (!direct.startsWith(MEETING_VIDEOS_DIR)) {
    return res.status(400).json({ error: '잘못된 영상 경로입니다' })
  }

  // DB 경로와 실제 폴더가 같을 때
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    return res.sendFile(direct)
  }

  // 예전에 unknown/unknown-date 로 저장된 파일은 이름만 맞아도 찾아줍니다.
  const found = findMeetingVideoByBasename(path.basename(relPath))
  if (found) return res.sendFile(found)

  return res.status(404).json({ error: '영상 파일을 찾지 못했습니다', path: relPath })
})

// 회의 채팅 첨부파일. 영상과 같이 이 서버 디스크에 저장합니다.
app.post('/api/chat-files/upload', checkUploadToken, uploadChatFile.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '업로드된 파일이 없습니다' })
  }

  const groupId = isSafePathSegment(req.body.groupId) ? req.body.groupId : 'unknown'
  const originalName = decodeMulterOriginalName(req.file.originalname)
  const filename = storedChatFileName(originalName)
  const destDir = path.join(CHAT_FILES_DIR, groupId)

  try {
    fs.mkdirSync(destDir, { recursive: true })
    fs.renameSync(req.file.path, path.join(destDir, filename))
  } catch (err) {
    console.error('채팅 파일 저장 실패:', err)
    try { fs.unlinkSync(req.file.path) } catch { /* 임시 파일 삭제는 실패해도 무시 */ }
    return res.status(500).json({ error: '파일을 디스크에 저장하지 못했습니다' })
  }

  const relativePath = `${groupId}/${filename}`
  console.log('채팅 첨부파일 저장 완료:', relativePath)
  res.json({
    path: relativePath,
    name: originalName,
    size: req.file.size,
    mime: guessChatFileMime(originalName, req.file.mimetype),
  })
})

/**
 * 그룹에 올라간 채팅/회의 첨부 파일 목록.
 * meeting-docs 가 비어 있을 때 문서 탭 「열기」 폴백으로 씁니다.
 */
app.get('/api/chat-files', (req, res) => {
  const groupId = req.query.groupId
  if (!isSafePathSegment(groupId)) {
    return res.status(400).json({ error: 'groupId 가 필요합니다' })
  }
  const dir = path.join(CHAT_FILES_DIR, groupId)
  if (!fs.existsSync(dir)) return res.json([])

  let names = []
  try {
    names = fs.readdirSync(dir)
  } catch (err) {
    console.error('채팅 파일 목록 읽기 실패:', err)
    return res.status(500).json({ error: '파일 목록을 읽지 못했습니다' })
  }

  const files = []
  for (const name of names) {
    if (name.startsWith('.')) continue
    const full = path.join(dir, name)
    let st
    try {
      st = fs.statSync(full)
    } catch {
      continue
    }
    if (!st.isFile()) continue
    // 저장 파일명 앞의 타임스탬프(ms)를 업로드 시각으로 씁니다.
    const tsMatch = /^(\d{13})-/.exec(name)
    const ts = tsMatch ? Number(tsMatch[1]) : st.mtimeMs
    files.push({
      id: name,
      name,
      path: `${groupId}/${name}`,
      size: st.size,
      mime: guessChatFileMime(name, ''),
      ts,
    })
  }

  files.sort((a, b) => b.ts - a.ts)
  res.json(files)
})

app.use('/files', (req, res, next) => {
  const relPath = decodeURIComponent(String(req.path || '').replace(/^\//, ''))
  if (!relPath) return next()

  const direct = path.resolve(CHAT_FILES_DIR, relPath)
  if (!direct.startsWith(CHAT_FILES_DIR)) {
    return res.status(400).json({ error: '잘못된 파일 경로입니다' })
  }
  if (fs.existsSync(direct) && fs.statSync(direct).isFile()) {
    // PDF·이미지를 보드 iframe에서 바로 보게 하려면 다운로드가 아니라 인라인이어야 합니다.
    const ext = path.extname(direct).toLowerCase()
    if (IMAGE_MIME_BY_EXT[ext] || ext === '.pdf' || ext === '.txt' || ext === '.md') {
      res.setHeader('Content-Disposition', 'inline')
    }
    return res.sendFile(direct)
  }
  return res.status(404).json({ error: '파일을 찾지 못했습니다', path: relPath })
})

/** 회의 문서 첨부 목록을 디스크에 저장합니다. (문서 탭 「열기」용) */
app.put('/api/meeting-docs/:meetingId', checkUploadToken, (req, res) => {
  const meetingId = String(req.params.meetingId || '')
  const groupId = req.body?.groupId
  if (!isSafePathSegment(meetingId) || !isSafePathSegment(groupId)) {
    return res.status(400).json({ error: '잘못된 회의/그룹 id 입니다' })
  }

  const files = Array.isArray(req.body?.files) ? req.body.files : []
  const normalized = files
    .filter((f) => f && typeof f.path === 'string' && typeof f.name === 'string')
    .map((f) => ({
      id: typeof f.id === 'string' ? f.id : undefined,
      name: String(f.name),
      path: String(f.path),
      size: typeof f.size === 'number' ? f.size : 0,
      mime: typeof f.mime === 'string' ? f.mime : 'application/octet-stream',
      ts: typeof f.ts === 'number' ? f.ts : Date.now(),
    }))

  const dir = path.join(MEETING_DOCS_DIR, groupId)
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    console.error('meeting-docs 폴더 생성 실패:', err)
    return res.status(500).json({ error: '문서 폴더를 만들지 못했습니다' })
  }

  const payload = {
    id: meetingId,
    groupId,
    title: typeof req.body?.title === 'string' ? req.body.title : '',
    date: typeof req.body?.date === 'string' ? req.body.date : new Date().toISOString(),
    files: normalized,
    updatedAt: new Date().toISOString(),
  }

  try {
    fs.writeFileSync(path.join(dir, `${meetingId}.json`), JSON.stringify(payload, null, 2), 'utf8')
  } catch (err) {
    console.error('meeting-docs 저장 실패:', err)
    return res.status(500).json({ error: '첨부 목록을 저장하지 못했습니다' })
  }

  console.log('회의 문서 첨부 저장:', groupId, meetingId, normalized.length)
  res.json(payload)
})

/** 한 회의의 첨부 목록 */
app.get('/api/meeting-docs/:meetingId', (req, res) => {
  const meetingId = String(req.params.meetingId || '')
  const groupId = req.query.groupId
  if (!isSafePathSegment(meetingId)) {
    return res.status(400).json({ error: '잘못된 회의 id 입니다' })
  }

  const tryRead = (gid) => {
    const filePath = path.join(MEETING_DOCS_DIR, gid, `${meetingId}.json`)
    if (!filePath.startsWith(MEETING_DOCS_DIR)) return null
    if (!fs.existsSync(filePath)) return null
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch {
      return null
    }
  }

  if (isSafePathSegment(groupId)) {
    const doc = tryRead(groupId)
    if (doc) return res.json(doc)
    return res.status(404).json({ error: '문서 첨부를 찾지 못했습니다' })
  }

  // groupId 없이 요청하면 모든 그룹 폴더에서 찾습니다.
  try {
    const groups = fs.readdirSync(MEETING_DOCS_DIR, { withFileTypes: true })
    for (const ent of groups) {
      if (!ent.isDirectory() || ent.name.startsWith('_')) continue
      const doc = tryRead(ent.name)
      if (doc) return res.json(doc)
    }
  } catch {
    /* ignore */
  }
  return res.status(404).json({ error: '문서 첨부를 찾지 못했습니다' })
})

/** 그룹의 회의 문서 목록(첨부 포함) — 문서 탭 보강용 */
app.get('/api/meeting-docs', (req, res) => {
  const groupId = req.query.groupId
  if (!isSafePathSegment(groupId)) {
    return res.status(400).json({ error: 'groupId 가 필요합니다' })
  }
  const dir = path.join(MEETING_DOCS_DIR, groupId)
  if (!fs.existsSync(dir)) return res.json([])

  let entries = []
  try {
    entries = fs.readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch {
    return res.json([])
  }

  const docs = []
  for (const name of entries) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))
      if (raw && raw.id) docs.push(raw)
    } catch {
      /* skip broken */
    }
  }
  docs.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
  res.json(docs)
})

// AI 요약 엔드포인트 — 타임스탬프가 붙은 챕터까지 생성합니다.
// R2 키(videoKey)면 원본을 내려받고, 예전 videoUrl(/videos/...)이면 디스크에서 읽습니다.
// 음성 추출과 요약은 aiSummary.js 가 합니다. 영상 파일 자체는 Groq로 보내지 않습니다.
app.post('/api/summarize', async (req, res) => {
  // R2에서 받은 원본은 요약이 끝나거나 실패해도 임시 폴더에 남기지 않습니다.
  let r2TempPath = null
  try {
    const rawVideoKey = typeof req.body?.videoKey === 'string' ? req.body.videoKey.trim() : ''
    const videoKey = rawVideoKey ? normalizeMeetingVideoKey(rawVideoKey) : ''
    if (rawVideoKey && !videoKey) {
      return res.status(400).json({ error: '잘못된 영상 키입니다' })
    }
    const videoUrl = typeof req.body?.videoUrl === 'string' ? req.body.videoUrl : ''
    const { chatLog, meetingDateLabel } = req.body
    const hasChatLog = Array.isArray(chatLog) && chatLog.length > 0
    if (!videoKey && !String(videoUrl || '').trim() && !hasChatLog) {
      return res.status(400).json({ error: 'videoKey, videoUrl, chatLog 중 하나는 필요합니다' })
    }

    const loadVideo = videoKey || String(videoUrl || '').trim()
      ? async () => {
          if (videoKey) {
            console.log('AI 요약 요청 (R2):', videoKey)
            r2TempPath = path.join(
              os.tmpdir(),
              `grop-r2-${Date.now()}-${Math.random().toString(36).slice(2)}.webm`,
            )
            await downloadMeetingVideoFromR2(videoKey, r2TempPath)
            return { filePath: r2TempPath }
          }

          console.log('AI 요약 요청 (디스크 영상):', videoUrl)
          // 예전 영상은 HTTPS로 다시 받지 않고, 이 컴퓨터에 저장된 파일을 읽습니다.
          // (Vite mkcert 인증서를 Node가 검증하지 못해 unable to verify the first certificate 가 납니다.)
          const localFile = resolveMeetingVideoFile(videoUrl)
          if (localFile) {
            console.log('디스크에서 영상 읽음:', localFile)
            return { filePath: localFile }
          }
          // 디스크에 없으면 같은 Node 서버의 HTTP /videos 로만 받습니다.
          // Vite(https://localhost:5173) 주소는 mkcert 때문에 Node fetch가 실패합니다.
          const rel = extractVideosRelativePath(videoUrl)
          const fetchUrl = rel
            ? `http://127.0.0.1:${process.env.PORT || 3001}/videos/${rel}`
            : videoUrl
          console.log('로컬 파일이 없어 URL로 받습니다:', fetchUrl)
          const response = await fetch(fetchUrl)
          if (!response.ok) {
            throw new Error(
              response.status === 404
                ? '이 컴퓨터에 녹화 파일이 없습니다. 회의를 이 서버에서 다시 녹화해 주세요.'
                : `영상을 내려받지 못했습니다 (HTTP ${response.status})`
            )
          }
          const buffer = Buffer.from(await response.arrayBuffer())
          console.log('영상 준비 완료! 크기:', buffer.length)
          return { buffer }
        }
      : null

    res.json(await summarizeMeeting({
      loadVideo,
      chatLog,
      meetingDateLabel: typeof meetingDateLabel === 'string' ? meetingDateLabel : '',
    }))
  } catch (err) {
    const message = summaryErrorMessage(err)
    console.error('AI 요약 실패:', message)
    res.status(500).json({ error: message })
  } finally {
    if (r2TempPath) {
      try { fs.rmSync(r2TempPath, { force: true }) } catch { /* 임시 파일 삭제가 실패해도 응답은 이미 끝났습니다 */ }
    }
  }
})

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '파일이 너무 큽니다. 20MB 이하만 첨부할 수 있어요.' })
  }
  return next(err)
})

const PORT = process.env.PORT || 3001
// Render 등 클라우드는 외부 헬스체크를 위해 0.0.0.0 바인딩이 필요합니다.
app.listen(PORT, '0.0.0.0', () => {
  console.log(`서버 실행중: port ${PORT}`)
  console.log(`  요약 모델: ${getChatModel()}`)
  console.log(`  음성 모델: ${getTranscribeModel()}`)
  console.log(`  녹화본 저장 경로(예전 영상): ${MEETING_VIDEOS_DIR}`)
  console.log(`  R2 버킷: ${process.env.R2_BUCKET || '(미설정 — 새 녹화 업로드 주소를 발급할 수 없음)'}`)
  console.log(`  채팅 첨부 경로: ${CHAT_FILES_DIR}`)
  console.log(`  회의 문서(첨부목록) 경로: ${MEETING_DOCS_DIR}`)
  // 요약은 시스템 ffmpeg로 음성만 뽑습니다. 없어도 서버는 켜 두고, 요약 요청 때 이유를 돌려줍니다.
  const ffmpegBin = process.env.FFMPEG_PATH || 'ffmpeg'
  execFile(ffmpegBin, ['-version'], { timeout: 10000 }, (err, stdout) => {
    if (err) {
      console.warn('  ffmpeg: 없음. 영상 요약은 서버에 ffmpeg를 설치한 뒤에 됩니다.')
      return
    }
    const first = String(stdout || '').split('\n')[0].trim()
    console.log(`  ffmpeg: ${first || '사용 가능'}`)
  })
  // 로컬 개발용 OAuth 폴백(127.0.0.1:3000). 클라우드에서는 불필요해 건너뜁니다.
  if (!process.env.RENDER && process.env.ENABLE_OAUTH_FALLBACK !== '0') {
    startOauthFallback()
  }
})