/**
 * 회의 AI 요약 공용 모듈
 * - Express 서버(server/index.js)와 Netlify 함수(netlify/functions/summarize.mjs)가 같이 씁니다.
 * - 영상 파일을 어디서 읽어오는지는 호출하는 쪽이 정하고(loadVideo), 여기서는
 *   오디오 추출 → Whisper 받아쓰기 → LLM 요약/챕터 생성만 담당합니다.
 */
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')

/**
 * npm 의존성(groq-sdk, ffmpeg-static)은 처음 쓸 때 불러옵니다.
 * Netlify 번들러는 server/ 폴더 안의 require 를 함수 번들에 넣지 못해 실행 시 "Cannot find module" 이 나므로,
 * Netlify 함수는 직접 import 한 모듈을 configureAiSummaryDeps 로 넘겨줍니다. Express 는 아래 require 를 그대로 씁니다.
 */
let deps = null

/** @param {{ Groq: any, toFile: Function, ffmpegPath?: string | null }} next */
function configureAiSummaryDeps(next) {
  deps = next
}

function getDeps() {
  if (!deps) {
    const groqSdk = require('groq-sdk')
    let ffmpegPath = null
    try {
      ffmpegPath = require('ffmpeg-static')
    } catch {
      /* ffmpeg-static 미설치 → FFMPEG_PATH 또는 PATH 의 ffmpeg 사용 */
    }
    deps = { Groq: groqSdk, toFile: groqSdk.toFile, ffmpegPath }
  }
  return deps
}

// 오디오 추출용 ffmpeg. ffmpeg-static 을 우선 쓰고,
// 없으면 FFMPEG_PATH 환경변수, 그것도 없으면 PATH 의 ffmpeg 를 씁니다.
function getFfmpegPath() {
  return getDeps().ffmpegPath || process.env.FFMPEG_PATH || 'ffmpeg'
}

// Groq Whisper 업로드 한도 (초과 시 친절히 안내)
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

// Groq은 모델을 자주 교체·폐기합니다(llama 계열은 이미 전부 내려갔습니다).
// 모델명이 404가 나면 코드를 고치지 말고 환경변수 GROQ_MODEL만 바꾸세요.
// 사용 가능한 목록 확인:
//   curl -H "Authorization: Bearer $GROQ_API_KEY" https://api.groq.com/openai/v1/models
// Express 는 이 모듈을 불러온 뒤에 dotenv 를 읽으므로, 모듈 로드 시점이 아니라 호출 시점에 환경변수를 읽습니다.
function getChatModel() {
  return process.env.GROQ_MODEL || 'openai/gpt-oss-120b'
}

function getTranscribeModel() {
  return process.env.GROQ_TRANSCRIBE_MODEL || 'whisper-large-v3'
}

function getGroq() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY 환경변수가 설정되지 않았습니다')
  }
  const { Groq } = getDeps()
  return new Groq({ apiKey: process.env.GROQ_API_KEY })
}

/** Groq SDK 400 메시지에서 실제 원인을 꺼냅니다. */
function groqErrorMessage(err) {
  const nested = err?.error?.error?.message || err?.error?.message
  if (nested && typeof nested === 'string') return nested
  return err?.message || String(err)
}

function isRetryableGroqStatus(status) {
  return status === 400 || status === 422
}

/** 모델이 마크다운 울타리와 함께 JSON을 줘도 파싱되게 합니다. */
function parseModelJson(raw) {
  const text = String(raw || '').trim()
  if (!text) throw new Error('AI 응답이 비어 있습니다. 다시 시도해 주세요.')
  try {
    return JSON.parse(text)
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1))
    }
    throw new Error('AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.')
  }
}

/** Whisper 옵션을 바꿔가며 재시도합니다. 영상 원본을 그대로 올리면 400이 자주 납니다. */
async function transcribeAudio(audioBuffer, isMp3) {
  const groq = getGroq()
  const { toFile } = getDeps()
  const makeFile = () => toFile(
    audioBuffer,
    isMp3 ? 'audio.mp3' : 'audio.webm',
    { type: isMp3 ? 'audio/mpeg' : 'audio/webm' },
  )
  const attempts = [
    { language: 'ko', response_format: 'verbose_json', timestamp_granularities: ['segment'] },
    { language: 'ko', response_format: 'verbose_json' },
    { response_format: 'verbose_json' },
    { language: 'ko' },
  ]
  let lastErr
  for (const opts of attempts) {
    try {
      return await groq.audio.transcriptions.create({
        file: await makeFile(),
        model: getTranscribeModel(),
        ...opts,
      })
    } catch (err) {
      lastErr = err
      if (!isRetryableGroqStatus(err.status)) throw err
      console.warn('Whisper 400, 옵션을 바꿔 재시도:', groqErrorMessage(err))
    }
  }
  throw lastErr
}

/** 정보 카드에 넣을 한 줄. 줄바꿈·앞뒤 공백을 없애고 길이를 자릅니다. */
function oneLine(value, max = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** JSON 모드가 400이면 일반 텍스트로 한 번 더 요청합니다. */
/**
 * usedChatFallback: 오디오가 아니라 채팅 기록으로 요약할 때(마이크 없음) true.
 *   채팅 기록에는 이미 실제 이름이 있어 화자를 추측할 필요가 없습니다.
 */
async function completeMeetingJson(transcriptForLlm, usedChatFallback = false, meetingDateLabel = '') {
  const groq = getGroq()
  const chatModel = getChatModel()
  // 날짜는 클라이언트가 넘긴 실제 회의 날짜만 씁니다. 없으면 모델이 날짜를 지어내지 않게 합니다.
  const dateHint = meetingDateLabel
    ? `회의 날짜는 "${meetingDateLabel}" 입니다. headline에는 이 날짜와 실제 주제를 한 줄로 쓰세요. 다른 날짜를 지어내지 마세요.`
    : '입력에 회의 날짜가 없으면 headline에 날짜를 지어내지 말고 주제만 한 줄로 쓰세요.'
  const speakerRule = usedChatFallback
    ? '입력에는 이미 각 줄에 실제 이름이 붙어 있습니다(예: "[00:10] 민수: ..."). speakers는 이름을 추측하지 말고 그 이름을 그대로 써서 각자가 한 말을 요약하세요.'
    : '녹취록에는 화자 표시가 없습니다. 기본적으로 화자는 1명("화자 1")이라고 가정하세요. '
      + '서로 다른 사람이 주고받는 명확한 증거(예: "네 맞아요", "~씨 생각은요?" 같은 호칭·맞장구·질문-대답)가 실제로 있을 때만 "화자 2", "화자 3" …으로 나누세요. '
      + '한 사람이 혼자 말하면서 화제가 바뀌거나 말투가 달라지는 것은 화자가 바뀐 게 아니니 나누지 마세요. 확신이 없으면 화자 1명으로 묶으세요(억지로 나누지 마세요). '
      + '이름이 대화 중 언급되면 "화자 1" 대신 그 이름을 써도 됩니다.'
  const inputKindLine = usedChatFallback
    ? '입력은 [MM:SS] 이름: 내용 형식의 회의 채팅 기록입니다(마이크 없이 텍스트로 진행한 회의).'
    : '입력은 [MM:SS] 형식의 타임스탬프가 붙은 회의 녹취록입니다.'
  const messages = [
    {
      role: 'system',
      content: `당신은 한국어 회의록을 정리하는 전문가입니다.
${inputKindLine}
화제가 바뀌는 지점을 찾아 챕터로 나누고, 반드시 아래 구조의 JSON만 출력하세요.

{
  "overview": "회의 전체를 6문장 이상으로 소개. 회의 목적, 다룬 안건, 나온 의견의 차이, 합의나 미결을 구체적으로 쓸 것. 한 줄 압축은 금지",
  "headline": "회의 날짜와 주제를 담은 제목 한 줄 (40자 이내). 예: 10월 8일 모니터 사양 검토",
  "topicLine": "이번 회의에서 실제로 다룬 내용을 한 줄로 (40자 이내). headline과 같은 문장을 반복하지 말 것",
  "chapters": [
    { "time": 0, "title": "짧은 소제목 (20자 이내)", "summary": "이 구간에서 실제로 말한 내용 2~3문장" }
  ],
  "topics": [
    { "topic": "논의 주제 이름 (예: 모니터 사양, 응답속도, 가격)", "detail": "그 주제만 5~8문장으로 자세히 서술. 누가 어떤 의견을 냈는지, 수치·제품명·비교·이유·반론·결론을 빠뜨리지 말 것" }
  ],
  "speakers": [
    { "speaker": "화자 1", "summary": "이 화자가 회의에서 한 이야기를 3~5문장으로 요약" }
  ],
  "decisions": ["확정된 결정을 이유와 함께 한 문장으로"],
  "actionItems": ["담당자가 있으면 이름과 함께 할 일을 한 문장으로"]
}

규칙:
- time은 반드시 초 단위 정수입니다. [01:30] 이면 90 입니다.
- 챕터는 입력에 실제로 등장한 타임스탬프만 사용하세요. 지어내지 마세요.
- 챕터는 3~8개가 적당하며, 시간 순으로 정렬하세요.
- 첫 챕터는 time 0 으로 시작하세요.
- headline과 topicLine은 각각 한 줄입니다. 줄바꿈·목록·따옴표로 감싸지 마세요.
- ${dateHint}
- topicLine은 입력에 실제로 나온 주제만 쓰고, headline의 문장을 그대로 복사하지 마세요.
- topics는 '시간'이 아니라 '무엇에 대해 이야기했는지' 기준으로 묶으세요. 녹취록에 나온 안건은 빠뜨리지 말고 2~8개로 나누세요.
- topics의 detail은 입력에 실제로 나온 내용만 쓰고, 없는 내용을 지어내지 마세요. 한 문장으로 줄이지 마세요.
- overview와 topics를 합치면 회의를 다시 읽지 않아도 논의 흐름이 이해되어야 합니다. 타임스탬프는 overview와 topics에 넣지 마세요.
- ${speakerRule}
- 내용이 없는 항목은 빈 배열로 두세요.`,
    },
    {
      role: 'user',
      content: `다음 ${usedChatFallback ? '채팅 기록' : '회의 녹취록'}을 JSON으로 정리해주세요:\n\n${transcriptForLlm}`,
    },
  ]

  const base = {
    model: chatModel,
    temperature: 0.3,
    messages,
    // gpt-oss 추론 토큰이 JSON을 깨며 400을 내는 것을 줄입니다.
    include_reasoning: false,
    reasoning_effort: 'low',
    max_completion_tokens: 8192,
  }

  const attempts = [
    { ...base, response_format: { type: 'json_object' } },
    { model: chatModel, temperature: 0.3, messages, response_format: { type: 'json_object' } },
    { model: chatModel, temperature: 0.2, messages, include_reasoning: false },
    { model: chatModel, temperature: 0.2, messages },
  ]

  let lastErr
  for (const opts of attempts) {
    try {
      const completion = await groq.chat.completions.create(opts)
      const rawContent = completion.choices[0]?.message?.content || ''
      return parseModelJson(rawContent)
    } catch (err) {
      lastErr = err
      if (err.status === 401 || err.status === 403 || err.status === 404) throw err
      console.warn('요약 JSON 실패, 재시도:', groqErrorMessage(err))
    }
  }
  throw lastErr
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

/**
 * 마이크 없이 진행한 회의(채팅만 있는 경우) 대비: 채팅 로그를
 * "[MM:SS] 이름: 내용" 형태로 만들어 오디오 녹취록 대신 씁니다.
 * 첫 메시지를 0초로 두고 상대 시간을 계산합니다.
 */
function buildTimestampedChatLog(chatLog) {
  if (!Array.isArray(chatLog)) return { text: '', durationSec: 0 }

  const sorted = chatLog
    .filter((m) => m && typeof m.text === 'string' && m.text.trim())
    .sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0))
  if (sorted.length === 0) return { text: '', durationSec: 0 }

  const startMs = Number(sorted[0].ts) || 0
  const endMs = Number(sorted[sorted.length - 1].ts) || startMs

  const text = sorted
    .map((m) => {
      const elapsedSec = Math.max(0, Math.round(((Number(m.ts) || startMs) - startMs) / 1000))
      const name = String(m.name || '').trim() || '참여자'
      return `[${formatTimestamp(elapsedSec)}] ${name}: ${m.text.trim()}`
    })
    .join('\n')

  return { text, durationSec: Math.max(0, Math.round((endMs - startMs) / 1000)) }
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

/**
 * 구조화된 결과 → meetings.summary에 저장할 사람이 읽는 텍스트.
 * 주제별 상세(topics)는 타임라인과 따로 두어, 화면의 핵심 요약과 PDF 본문에 남깁니다.
 * @param {{ topic: string, detail: string }[]} topics
 */
function buildSummaryText(result, chapters, topics = []) {
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

  // 시간 순 목차와 별개로, 안건마다 오간 이야기를 본문에 남깁니다.
  if (topics.length > 0) {
    lines.push('📝 논의 내용')
    for (const topic of topics) {
      lines.push(topic.topic)
      if (topic.detail) lines.push(topic.detail)
      lines.push('')
    }
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

/**
 * 녹화 파일에서 오디오만 뽑아 16kHz mono MP3(32kbps)로 변환합니다.
 * 회의 녹화(webm, 영상+음성)는 금방 25MB(Whisper 업로드 한도)를 넘지만,
 * 이렇게 줄이면 1시간짜리도 약 14MB 안쪽이라 한도 문제가 사라집니다.
 *
 * @param {string} inputPath 로컬 파일 경로 (없으면 buffer 사용)
 * @param {Buffer|null} inputBuffer 경로가 없을 때 임시 파일로 쓸 원본 버퍼
 * @returns {Promise<Buffer>} 변환된 mp3 버퍼
 */
function extractAudio(inputPath, inputBuffer) {
  return new Promise((resolve, reject) => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const outPath = path.join(os.tmpdir(), `grop-audio-${stamp}.mp3`)

    // 경로가 없으면(HTTP fallback 등) 버퍼를 임시 파일로 떨어뜨려 입력으로 씁니다.
    let tmpInPath = null
    let realInput = inputPath
    if (!realInput) {
      if (!Buffer.isBuffer(inputBuffer)) {
        reject(new Error('오디오 추출 입력이 없습니다'))
        return
      }
      tmpInPath = path.join(os.tmpdir(), `grop-src-${stamp}.webm`)
      fs.writeFileSync(tmpInPath, inputBuffer)
      realInput = tmpInPath
    }

    const cleanup = () => {
      if (tmpInPath) fs.rmSync(tmpInPath, { force: true })
      fs.rmSync(outPath, { force: true })
    }

    const args = ['-y', '-i', realInput, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', outPath]
    execFile(getFfmpegPath(), args, { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 * 10 }, (err) => {
      if (err) {
        cleanup()
        reject(new Error(`오디오 추출 실패: ${err.message}`))
        return
      }
      try {
        const out = fs.readFileSync(outPath)
        resolve(out)
      } catch (readErr) {
        reject(readErr)
      } finally {
        cleanup()
      }
    })
  })
}

/**
 * 영상(있으면) → 오디오 → 받아쓰기 → 요약 전체 흐름.
 * 마이크 없이 진행했거나 영상 처리에 실패하면 채팅 기록으로 대신 요약합니다.
 *
 * @param {object} options
 * @param {(() => Promise<{ filePath?: string, buffer?: Buffer }>) | null} options.loadVideo
 *   영상을 읽어오는 함수. 저장 위치(서버 디스크, Netlify Blobs 등)는 호출하는 쪽이 정합니다.
 * @param {Array|null} options.chatLog 회의 채팅 기록
 * @param {string} [options.meetingDateLabel] 카드 "회의 날짜"에 쓸 실제 날짜 (예: 2026년 10월 8일)
 * @returns {Promise<object>} 클라이언트에 그대로 내려줄 요약 결과
 */
async function summarizeMeeting({ loadVideo, chatLog, meetingDateLabel = '' }) {
  const hasChatLog = Array.isArray(chatLog) && chatLog.length > 0
  let transcriptForLlm = ''
  let durationSec = 0
  let usedChatFallback = false

  // 1. 영상이 있으면 먼저 오디오 → 텍스트를 시도합니다.
  //    (마이크 없이 진행했거나 처리 중 문제가 생기면 던지지 않고 채팅 기록으로 넘어갑니다.)
  if (loadVideo) {
    try {
      const source = await loadVideo()

      // 영상 전체를 그대로 올리면 Whisper 25MB 한도를 금방 넘습니다.
      // 오디오만 16kHz mono 32kbps mp3로 뽑아 용량을 10~20배 줄입니다.
      let audioBuffer
      try {
        audioBuffer = await extractAudio(source.filePath || null, source.buffer || null)
        console.log('오디오 추출 완료! 크기:', audioBuffer.length)
      } catch (audioErr) {
        // 영상 webm을 Whisper에 그대로 올리면 Groq가 400을 주는 경우가 많아, 추출 실패는 여기서 멈추고
        // (바깥 catch가 잡아서) 채팅 기록 대체로 넘어갑니다.
        throw new Error(`오디오를 추출하지 못했습니다: ${audioErr.message}`)
      }

      if (audioBuffer.length > MAX_AUDIO_BYTES) {
        throw new Error(
          `오디오가 여전히 너무 큽니다 (${(audioBuffer.length / 1024 / 1024).toFixed(1)}MB). `
          + `현재 한도는 ${MAX_AUDIO_BYTES / 1024 / 1024}MB 입니다. 회의를 나눠서 녹화해 주세요.`,
        )
      }

      // 2. Groq Whisper로 음성 → 텍스트 (구간별 타임스탬프 포함, 400이면 옵션을 낮춰 재시도)
      console.log('음성 변환 중...')
      const transcription = await transcribeAudio(audioBuffer, true)

      const transcript = transcription.text || ''
      const segments = Array.isArray(transcription.segments) ? transcription.segments : []
      console.log(`변환 완료: ${segments.length}개 구간, ${(Number(transcription.duration) || 0).toFixed(0)}초`)

      if (transcript.trim()) {
        durationSec = Number(transcription.duration) || 0
        // 타임스탬프가 있으면 그걸 쓰고, 없으면 평문으로 대체
        transcriptForLlm = segments.length > 0 ? buildTimestampedTranscript(segments) : transcript
      } else {
        console.log('오디오에서 텍스트를 뽑지 못했습니다 (마이크 없이 진행한 회의일 수 있음) — 채팅 기록으로 대체를 시도합니다.')
      }
    } catch (audioPathErr) {
      // 영상/음성 처리 중 어떤 이유로든 실패해도 바로 에러를 내지 않고, 채팅 기록으로 대체를 시도합니다.
      console.warn('영상/음성 처리 실패, 채팅 기록으로 대체를 시도합니다:', audioPathErr.message)
    }
  }

  // 3. 오디오로 텍스트를 못 얻었으면(마이크 없음 등) 채팅 기록으로 대체합니다.
  if (!transcriptForLlm.trim() && hasChatLog) {
    const chatResult = buildTimestampedChatLog(chatLog)
    if (chatResult.text.trim()) {
      console.log(`채팅 기록으로 요약합니다: 메시지 ${chatLog.length}개`)
      transcriptForLlm = chatResult.text
      durationSec = chatResult.durationSec
      usedChatFallback = true
    }
  }

  if (!transcriptForLlm.trim()) {
    throw new Error('요약할 내용이 없습니다. 마이크 음성도, 채팅 기록도 확인되지 않았어요.')
  }

  // 4. 챕터 + 요약 JSON 생성 (json_object 400이면 일반 응답으로 재시도, 채팅 대체 시 화자 규칙도 다르게)
  console.log('요약/챕터 생성 중...')
  const parsed = await completeMeetingJson(transcriptForLlm, usedChatFallback, String(meetingDateLabel || '').trim())

  const chapters = normalizeChapters(parsed.chapters, durationSec)

  // 주제별요약: { topic, detail } 배열만 추려서 그대로 넘깁니다.
  const topics = Array.isArray(parsed.topics)
    ? parsed.topics
        .filter((t) => t && typeof t.topic === 'string' && t.topic.trim())
        .map((t) => ({ topic: String(t.topic).trim(), detail: String(t.detail || '').trim() }))
    : []
  const summaryText = buildSummaryText(parsed, chapters, topics)
  // 발언자별요약: { speaker, summary } (녹취록에 화자 표시가 없어 LLM 추정치)
  const speakers = Array.isArray(parsed.speakers)
    ? parsed.speakers
        .filter((s) => s && typeof s.speaker === 'string' && s.speaker.trim() && String(s.summary || '').trim())
        .map((s) => ({ speaker: String(s.speaker).trim(), summary: String(s.summary).trim() }))
    : []
  // 정보 카드용 한 줄. 모델이 비우면 주제 이름으로 대체합니다.
  const headline = oneLine(parsed.headline, 60) || oneLine(topics[0]?.topic, 60)
  const topicLine = oneLine(parsed.topicLine, 80) || oneLine(topics.map((t) => t.topic).join(', '), 80)
  console.log(`요약 완료! (${usedChatFallback ? '채팅 기록' : '음성'} 기반) 챕터 ${chapters.length}개, 주제 ${topics.length}개, 화자 ${speakers.length}명`)

  return {
    success: true,
    headline,
    topicLine,
    // 상세요약 = 타임스탬프가 붙은 전체 녹취록(영상 풀내용, 채팅 대체 시 채팅 로그)
    transcript: transcriptForLlm,
    summary: summaryText,
    chapters,
    topics,
    speakers,
    duration: durationSec,
    // 클라이언트가 "채팅 기록으로 요약했어요" 안내를 띄울 때 씁니다.
    source: usedChatFallback ? 'chat' : 'audio',
  }
}

/** 요약 실패 메시지. 모델 폐기(404)는 원인을 알기 어려우니 해결 방법을 같이 알려줍니다. */
function summaryErrorMessage(err) {
  const message = groqErrorMessage(err)
  const looksLikeModelError = err?.status === 404
    || /model|decommission|does not exist/i.test(message)
  const hint = looksLikeModelError
    ? `\n\n사용 중인 모델(${getChatModel()})이 폐기됐을 수 있습니다.`
      + '\n환경변수 GROQ_MODEL=사용가능한모델명 을 설정한 뒤 다시 시도하세요.'
    : ''
  return `${message}${hint}`
}

module.exports = {
  configureAiSummaryDeps,
  getChatModel,
  getTranscribeModel,
  summarizeMeeting,
  summaryErrorMessage,
}
