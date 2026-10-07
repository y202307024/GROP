/**
 * POST /api/summarize  본문 { videoUrl, chatLog } — Express 와 같은 요청/응답
 * 요약 흐름(오디오 추출 → Whisper → LLM)은 server/aiSummary.js 를 그대로 씁니다.
 * 여기서는 "영상을 Netlify Blobs 에서 꺼내 /tmp 파일로 만드는 것"만 담당합니다.
 *
 * 필요한 환경변수(Functions 범위): GROQ_API_KEY (선택: GROQ_MODEL, GROQ_TRANSCRIBE_MODEL)
 * 주의: 동기 함수는 60초 제한이라 긴 회의 녹화는 시간 초과가 날 수 있습니다.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegPath from 'ffmpeg-static'
import Groq, { toFile } from 'groq-sdk'
import aiSummary from '../../server/aiSummary.js'
import { json, metaKey, partKey, uploadsStore } from '../lib/uploads.mjs'

const { configureAiSummaryDeps, summarizeMeeting, summaryErrorMessage } = aiSummary

// 이 파일에서 직접 import 해야 Netlify 번들러가 두 모듈을 함수 번들에 포함합니다. (aiSummary.js 주석 참고)
configureAiSummaryDeps({ Groq, toFile, ffmpegPath })

/** videoUrl(https://사이트/videos/그룹/날짜/파일.webm) → Blobs key(videos/그룹/날짜/파일.webm) */
function videoKeyFromUrl(videoUrl) {
  const raw = String(videoUrl || '').trim()
  const marker = '/videos/'
  const idx = raw.indexOf(marker)
  let rel = idx >= 0 ? raw.slice(idx + marker.length).split('?')[0] : raw.replace(/^\/+/, '')
  try {
    rel = decodeURIComponent(rel)
  } catch {
    // 이미 디코드된 경로는 그대로 씁니다.
  }
  if (rel.endsWith('.url.txt')) rel = rel.slice(0, -'.url.txt'.length)
  if (!rel || rel.includes('..')) return null
  return `videos/${rel}`
}

/** Blobs 조각을 순서대로 이어 붙여 /tmp 파일로 만듭니다. (ffmpeg 는 파일 경로 입력이 가장 안정적) */
async function downloadBlobToTmp(store, meta, tmpPath) {
  const out = fs.createWriteStream(tmpPath)
  try {
    for (let i = 0; i < meta.parts; i++) {
      const buf = await store.get(partKey(meta.key, i), { type: 'arrayBuffer' })
      if (!buf) throw new Error(`녹화본 ${i + 1}번째 조각이 없습니다`)
      if (!out.write(Buffer.from(buf))) {
        await new Promise((resolve) => out.once('drain', resolve))
      }
    }
  } finally {
    await new Promise((resolve) => out.end(resolve))
  }
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST 만 지원합니다' }, 405)

  // loadVideo 가 만든 임시 파일은 요약이 끝나면(성공/실패 무관) 지웁니다.
  let tmpPath = null
  try {
    const { videoUrl, chatLog } = (await req.json().catch(() => ({}))) || {}
    const hasChatLog = Array.isArray(chatLog) && chatLog.length > 0
    if ((!videoUrl || typeof videoUrl !== 'string') && !hasChatLog) {
      return json({ error: 'videoUrl 또는 chatLog 중 하나는 필요합니다' }, 400)
    }

    const loadVideo = videoUrl && typeof videoUrl === 'string'
      ? async () => {
          console.log('AI 요약 요청 (영상):', videoUrl)
          tmpPath = path.join(os.tmpdir(), `grop-video-${Date.now()}-${Math.random().toString(36).slice(2)}.webm`)

          const key = videoKeyFromUrl(videoUrl)
          const store = uploadsStore()
          const meta = key ? await store.get(metaKey(key), { type: 'json' }) : null
          if (meta) {
            await downloadBlobToTmp(store, meta, tmpPath)
            console.log('Blobs 에서 영상 준비 완료:', key, meta.size)
            return { filePath: tmpPath }
          }

          // Blobs 에 없는 예전 녹화본(Render 서버 주소 등)은 URL 로 직접 받아 봅니다.
          if (!/^https?:\/\//i.test(videoUrl)) throw new Error('녹화 파일을 찾지 못했습니다')
          const response = await fetch(videoUrl)
          if (!response.ok) throw new Error(`영상을 내려받지 못했습니다 (HTTP ${response.status})`)
          fs.writeFileSync(tmpPath, Buffer.from(await response.arrayBuffer()))
          return { filePath: tmpPath }
        }
      : null

    return json(await summarizeMeeting({ loadVideo, chatLog }))
  } catch (err) {
    const message = summaryErrorMessage(err)
    console.error('AI 요약 실패:', message)
    return json({ error: message }, 500)
  } finally {
    if (tmpPath) fs.rmSync(tmpPath, { force: true })
  }
}

export const config = {
  path: '/api/summarize',
}
