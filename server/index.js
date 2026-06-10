const express = require('express')
const cors = require('cors')
const dotenv = require('dotenv')
const { AccessToken } = require('livekit-server-sdk')
const Groq = require('groq-sdk')
const { toFile } = require('groq-sdk')

// node-fetch dynamic import
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))

const path = require('path')
dotenv.config({ path: path.resolve(__dirname, '../.env') })

const app = express()
app.use(cors())
app.use(express.json({ limit: '50mb' }))

function getGroq() {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY가 .env에 설정되지 않았습니다')
  }
  return new Groq({ apiKey: process.env.GROQ_API_KEY })
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

// AI 요약 엔드포인트
app.post('/api/summarize', async (req, res) => {
  try {
    const { videoUrl } = req.body
    console.log('AI 요약 요청:', videoUrl)

    // 1. 영상 파일 다운로드
    console.log('영상 다운로드 중...')
    const response = await fetch(videoUrl)
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    console.log('다운로드 완료! 크기:', buffer.length)

    // 2. Groq Whisper로 음성 → 텍스트 변환
    console.log('음성 변환 중...')
    const groq = getGroq()
    const transcription = await groq.audio.transcriptions.create({
      file: await toFile(buffer, 'audio.webm', { type: 'audio/webm' }),
      model: 'whisper-large-v3',
      language: 'ko',
    })

    const transcript = transcription.text
    console.log('변환 완료:', transcript.slice(0, 100))

    // 3. Groq LLaMA로 요약
    console.log('요약 중...')
    const summary = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `당신은 회의록을 정리하는 전문가입니다. 
아래 형식으로 한국어로 작성해주세요:

📋 회의 핵심 요약
(2~3문장으로 전체 요약)

✅ 결정 사항
- (결정된 내용들)

📝 주요 논의
- (주요 논의 내용들)

⚡ 다음 할 일
- (액션 아이템들)`
        },
        {
          role: 'user',
          content: `다음 회의 내용을 정리해주세요:\n\n${transcript}`
        }
      ],
      temperature: 0.3,
    })

    const summaryText = summary.choices[0].message.content
    console.log('요약 완료!')

    res.json({
      success: true,
      transcript,
      summary: summaryText
    })

  } catch (err) {
    console.error('AI 요약 실패:', err.message)
    res.status(500).json({ error: err.message })
  }
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`서버 실행중: port ${PORT}`)
})