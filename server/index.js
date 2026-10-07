const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const { AccessToken, RoomServiceClient } = require('livekit-server-sdk')
const multer = require('multer')
const fs = require('fs')

// node-fetch dynamic import
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))

const path = require('path')
const { startOauthFallback, rememberOauthOrigin, getOauthOrigin } = require('./oauthFallback')
// AI 요약(오디오 추출 → Whisper → LLM) 로직은 Netlify 함수와 함께 쓰려고 별도 모듈로 분리했습니다.
const { getChatModel, getTranscribeModel, summarizeMeeting, summaryErrorMessage } = require('./aiSummary')
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))


// ─────────────────────────────────────────────────────────────
// 회의 녹화 영상 저장 (Supabase Storage 대신 이 컴퓨터 디스크에 저장)
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

// 클라이언트(Room.tsx)가 녹화 종료 시 이 엔드포인트로 webm blob 을 보냅니다.
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
// 실제 요약 흐름은 aiSummary.js 에 있고, 여기서는 "영상을 이 서버 디스크에서 어떻게 읽는지"만 정합니다.
app.post('/api/summarize', async (req, res) => {
  try {
    const { videoUrl, chatLog } = req.body
    const hasChatLog = Array.isArray(chatLog) && chatLog.length > 0
    if ((!videoUrl || typeof videoUrl !== 'string') && !hasChatLog) {
      return res.status(400).json({ error: 'videoUrl 또는 chatLog 중 하나는 필요합니다' })
    }

    const loadVideo = videoUrl && typeof videoUrl === 'string'
      ? async () => {
          console.log('AI 요약 요청 (영상):', videoUrl)
          // 영상은 HTTPS로 다시 받지 않고, 이 컴퓨터에 저장된 파일을 읽습니다.
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

    res.json(await summarizeMeeting({ loadVideo, chatLog }))
  } catch (err) {
    const message = summaryErrorMessage(err)
    console.error('AI 요약 실패:', message)
    res.status(500).json({ error: message })
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
  console.log(`  녹화본 저장 경로: ${MEETING_VIDEOS_DIR}`)
  console.log(`  채팅 첨부 경로: ${CHAT_FILES_DIR}`)
  console.log(`  회의 문서(첨부목록) 경로: ${MEETING_DOCS_DIR}`)
  // 로컬 개발용 OAuth 폴백(127.0.0.1:3000). 클라우드에서는 불필요해 건너뜁니다.
  if (!process.env.RENDER && process.env.ENABLE_OAUTH_FALLBACK !== '0') {
    startOauthFallback()
  }
})