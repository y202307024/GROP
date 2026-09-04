const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const { AccessToken } = require('livekit-server-sdk')
const Groq = require('groq-sdk')
const { toFile } = require('groq-sdk')
const multer = require('multer')
const fs = require('fs')

// node-fetch dynamic import
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))

const path = require('path')
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

// Groq Whisper 업로드 한도 (초과 시 친절히 안내)
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

// Groq은 모델을 자주 교체·폐기합니다(llama 계열은 이미 전부 내려갔습니다).
// 모델명이 404가 나면 코드를 고치지 말고 .env의 GROQ_MODEL만 바꾸세요.
// 사용 가능한 목록 확인:
//   curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models
const CHAT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
const TRANSCRIBE_MODEL = process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3'

// ─────────────────────────────────────────────────────────────
// 회의 녹화 영상 저장 (Supabase Storage 대신 이 컴퓨터 디스크에 저장)
// Supabase meetings.video_url 에는 이 폴더 기준 상대경로만 저장됩니다.
// ─────────────────────────────────────────────────────────────
const MEETING_VIDEOS_DIR = path.resolve(__dirname, 'uploads', 'meeting-videos')
fs.mkdirSync(MEETING_VIDEOS_DIR, { recursive: true })

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

// group_id/날짜 폴더 구조는 예전 Supabase Storage 경로 규칙과 동일하게 맞춥니다.
const meetingVideoStorage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const groupId = String(req.body.groupId || 'unknown')
    const dateStr = String(req.body.dateStr || 'unknown-date')
    const dir = path.join(MEETING_VIDEOS_DIR, groupId, dateStr)
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (_req, file, cb) => {
    const ext = file.originalname?.split('.').pop() || 'webm'
    cb(null, `${Date.now()}.${ext}`)
  },
})

const uploadMeetingVideo = multer({
  storage: meetingVideoStorage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB. 필요하면 조정하세요.
})

function getGroq() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY가 .env에 설정되지 않았습니다')
  }
  return new Groq({ apiKey: process.env.GROQ_API_KEY })
}

/** 초 → "MM:SS" 또는 "H:MM:SS" */
function formatTimestamp(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Whisper segment 배열 → "[MM:SS] 발화" 형태의 녹취록 */
function buildTimestampedTranscript(segments) {
  return segments
    .map((seg) => `[${formatTimestamp(seg.start)}] ${String(seg.text || '').trim()}`)
    .filter((line) => line.length > 12)
    .join('\n')
}

/** LLM이 뱉은 chapters를 검증·정규화 (시간 범위 밖 / 제목 없음 제거) */
function normalizeChapters(raw, durationSec) {
  if (!Array.isArray(raw)) return []

  const list = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue

    let time = null
    if (typeof item.time === 'number' && Number.isFinite(item.time)) {
      time = Math.max(0, Math.floor(item.time))
    } else if (typeof item.time === 'string' && /^\d+(:\d{1,2}){0,2}$/.test(item.time.trim())) {
      time = item.time.trim().split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0)
    }
    if (time === null) continue
    if (durationSec > 0 && time > durationSec + 1) continue

    const title = typeof item.title === 'string' ? item.title.trim() : ''
    if (!title) continue

    const summary = typeof item.summary === 'string' ? item.summary.trim() : ''
    list.push({ time, title, summary: summary || undefined })
  }

  list.sort((a, b) => a.time - b.time)

  const deduped = []
  for (const c of list) {
    if (deduped.length > 0 && deduped[deduped.length - 1].time === c.time) continue
    deduped.push(c)
  }
  return deduped
}

/** 구조화된 결과 → meetings.summary에 저장할 사람이 읽는 텍스트 */
function buildSummaryText(result, chapters) {
  const lines = []

  lines.push('📋 회의 핵심 요약')
  lines.push(result.overview || '(요약 없음)')
  lines.push('')

  if (chapters.length > 0) {
    lines.push('🕘 타임라인')
    for (const c of chapters) {
      lines.push(`[${formatTimestamp(c.time)}] ${c.title}`)
      if (c.summary) lines.push(`    ${c.summary}`)
    }
    lines.push('')
  }

  const decisions = Array.isArray(result.decisions) ? result.decisions.filter(Boolean) : []
  if (decisions.length > 0) {
    lines.push('✅ 결정 사항')
    for (const d of decisions) lines.push(`- ${d}`)
    lines.push('')
  }

  const actionItems = Array.isArray(result.actionItems) ? result.actionItems.filter(Boolean) : []
  if (actionItems.length > 0) {
    lines.push('⚡ 다음 할 일')
    for (const a of actionItems) lines.push(`- ${a}`)
  }

  return lines.join('\n').trim()
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok' })
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
    token.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    })

    const jwt = await token.toJwt()
    console.log('토큰 발급 성공!')
    res.json({ token: jwt })
  } catch (err) {
    console.error('토큰 발급 실패:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// 클라이언트(Room.tsx)가 녹화 종료 시 이 엔드포인트로 webm blob 을 보냅니다.
// 저장 위치는 Supabase Storage 가 아니라 이 서버 컴퓨터의 디스크입니다.
app.post('/api/meetings/upload', checkUploadToken, uploadMeetingVideo.single('video'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '업로드된 파일이 없습니다' })
  }
  const groupId = String(req.body.groupId || 'unknown')
  const dateStr = String(req.body.dateStr || 'unknown-date')
  // Supabase meetings.video_url 에는 이 상대경로만 저장하면 됩니다.
  const relativePath = `${groupId}/${dateStr}/${req.file.filename}`
  console.log('회의 녹화본 저장 완료:', relativePath)
  res.json({ path: relativePath })
})

// 저장된 녹화본을 서빙합니다.
// express.static 은 내부적으로 Range 헤더를 지원해서(send 모듈) <video> 탐색(seek)이 정상 동작합니다.
app.use('/videos', express.static(MEETING_VIDEOS_DIR))

// AI 요약 엔드포인트 — 타임스탬프가 붙은 챕터까지 생성합니다.
app.post('/api/summarize', async (req, res) => {
  try {
    const { videoUrl } = req.body
    if (!videoUrl || typeof videoUrl !== 'string') {
      return res.status(400).json({ error: 'videoUrl이 필요합니다' })
    }
    console.log('AI 요약 요청:', videoUrl)

    // 1. 영상 파일 다운로드
    console.log('영상 다운로드 중...')
    const response = await fetch(videoUrl)
    if (!response.ok) {
      throw new Error(`영상을 내려받지 못했습니다 (HTTP ${response.status})`)
    }
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    console.log('다운로드 완료! 크기:', buffer.length)

    if (buffer.length > MAX_AUDIO_BYTES) {
      throw new Error(
        `녹화 파일이 너무 큽니다 (${(buffer.length / 1024 / 1024).toFixed(1)}MB). ` +
        `현재 한도는 ${MAX_AUDIO_BYTES / 1024 / 1024}MB 입니다.`
      )
    }

    // 2. Groq Whisper로 음성 → 텍스트 (구간별 타임스탬프 포함)
    console.log('음성 변환 중...')
    const groq = getGroq()
    const transcription = await groq.audio.transcriptions.create({
      file: await toFile(buffer, 'audio.webm', { type: 'audio/webm' }),
      model: TRANSCRIBE_MODEL,
      language: 'ko',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    })

    const transcript = transcription.text || ''
    const segments = Array.isArray(transcription.segments) ? transcription.segments : []
    const durationSec = Number(transcription.duration) || 0
    console.log(`변환 완료: ${segments.length}개 구간, ${durationSec.toFixed(0)}초`)

    if (!transcript.trim()) {
      throw new Error('음성에서 텍스트를 추출하지 못했습니다. 녹화에 소리가 들어갔는지 확인해 주세요.')
    }

    // 타임스탬프가 있으면 그걸 쓰고, 없으면 평문으로 대체
    const transcriptForLlm = segments.length > 0
      ? buildTimestampedTranscript(segments)
      : transcript

    // 3. Groq LLaMA로 챕터 + 요약 생성 (JSON 모드)
    console.log('요약/챕터 생성 중...')
    const completion = await groq.chat.completions.create({
      model: CHAT_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content: `당신은 한국어 회의록을 정리하는 전문가입니다.
입력은 [MM:SS] 형식의 타임스탬프가 붙은 회의 녹취록입니다.
화제가 바뀌는 지점을 찾아 챕터로 나누고, 반드시 아래 구조의 JSON만 출력하세요.

{
  "overview": "회의 전체를 2~3문장으로 요약",
  "chapters": [
    { "time": 0, "title": "짧은 소제목 (20자 이내)", "summary": "이 구간에서 다룬 내용 1~2문장" }
  ],
  "decisions": ["확정된 결정 사항"],
  "actionItems": ["담당자와 할 일"]
}

규칙:
- time은 반드시 초 단위 정수입니다. [01:30] 이면 90 입니다.
- 챕터는 녹취록에 실제로 등장한 타임스탬프만 사용하세요. 지어내지 마세요.
- 챕터는 3~8개가 적당하며, 시간 순으로 정렬하세요.
- 첫 챕터는 time 0 으로 시작하세요.
- 내용이 없는 항목은 빈 배열로 두세요.`,
        },
        {
          role: 'user',
          content: `다음 회의 녹취록을 JSON으로 정리해주세요:\n\n${transcriptForLlm}`,
        },
      ],
    })

    const rawContent = completion.choices[0]?.message?.content || '{}'
    let parsed
    try {
      parsed = JSON.parse(rawContent)
    } catch {
      throw new Error('AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.')
    }

    const chapters = normalizeChapters(parsed.chapters, durationSec)
    const summaryText = buildSummaryText(parsed, chapters)
    console.log(`요약 완료! 챕터 ${chapters.length}개`)

    res.json({
      success: true,
      transcript,
      summary: summaryText,
      chapters,
      duration: durationSec,
    })
  } catch (err) {
    console.error('AI 요약 실패:', err.message)
    // 모델 폐기(404)는 원인을 알기 어려우니 해결 방법을 같이 알려줍니다.
    const looksLikeModelError = err.status === 404
      || /model|decommission|does not exist/i.test(err.message || '')
    const hint = looksLikeModelError
      ? `\n\n사용 중인 모델(${CHAT_MODEL})이 폐기됐을 수 있습니다.`
        + '\n.env에 GROQ_MODEL=사용가능한모델명 을 추가한 뒤 서버를 재시작하세요.'
      : ''
    res.status(500).json({ error: `${err.message}${hint}` })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`서버 실행중: port ${PORT}`)
  console.log(`  요약 모델: ${CHAT_MODEL}`)
  console.log(`  음성 모델: ${TRANSCRIBE_MODEL}`)
  console.log(`  녹화본 저장 경로: ${MEETING_VIDEOS_DIR}`)
})