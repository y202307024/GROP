/**
 * GET /videos/*, /files/* — Netlify Blobs 에 조각으로 저장된 업로드 파일을 내려줍니다.
 * (Express 의 app.use('/videos'), app.use('/files') 대체)
 *
 * 일반 함수는 응답 크기 한도(스트리밍 20MB)가 있어 긴 녹화 영상을 못 내려주므로,
 * 한도가 없는 엣지 함수에서 조각을 순서대로 이어 스트리밍합니다.
 * <video> 가 구간 이동(seek)할 때 보내는 Range 요청에는 해당 구간만 206 으로 응답합니다.
 *
 * 저장 구조는 netlify/lib/uploads.mjs 주석 참고 (meta/<key>, parts/<key>/<index>)
 */
import { getStore } from '@netlify/blobs'

const INLINE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|pdf|txt|md)$/i

/** "bytes=start-end" 파싱. 형식이 이상하거나 범위를 벗어나면 null(전체 응답)로 처리합니다. */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim())
  if (!match || size === 0) return null
  let start
  let end
  if (match[1] === '') {
    // "bytes=-500" → 마지막 500바이트
    const suffix = Number(match[2])
    if (!suffix) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1)
  }
  if (start > end || start >= size) return 'unsatisfiable'
  return { start, end }
}

/** start~end 바이트를 덮는 조각들만 꺼내, 필요한 부분만 잘라 차례로 흘려보냅니다. */
function streamRange(store, meta, start, end) {
  const partSize = meta.partSize
  let part = Math.floor(start / partSize)
  const lastPart = Math.floor(end / partSize)

  return new ReadableStream({
    // pull 방식이라 브라우저가 연결을 끊으면(다른 구간으로 seek) 더 이상 조각을 읽지 않습니다.
    async pull(controller) {
      if (part > lastPart) {
        controller.close()
        return
      }
      const buf = await store.get(`parts/${meta.key}/${part}`, { type: 'arrayBuffer' })
      if (!buf) {
        controller.error(new Error(`조각 ${part} 없음`))
        return
      }
      const partStart = part * partSize
      const from = Math.max(0, start - partStart)
      const to = Math.min(buf.byteLength, end - partStart + 1)
      controller.enqueue(new Uint8Array(buf, from, to - from))
      part += 1
    },
  })
}

export default async (req) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const url = new URL(req.url)
  let key
  try {
    // /videos/a/b.webm → videos/a/b.webm (앞 슬래시 제거, 한글 등 퍼센트 인코딩 해제)
    key = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  } catch {
    return Response.json({ error: '잘못된 경로입니다' }, { status: 400 })
  }
  if (key.endsWith('.url.txt')) key = key.slice(0, -'.url.txt'.length)
  if (key.includes('..')) return Response.json({ error: '잘못된 경로입니다' }, { status: 400 })

  const store = getStore({ name: 'grop-uploads', consistency: 'strong' })
  const meta = await store.get(`meta/${key}`, { type: 'json' })
  if (!meta) {
    return Response.json({ error: '파일을 찾지 못했습니다', path: key }, { status: 404 })
  }

  const size = Number(meta.size) || 0
  const headers = new Headers({
    'Content-Type': meta.mime || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  })
  // PDF·이미지를 보드 iframe에서 바로 보게 하려면 다운로드가 아니라 인라인이어야 합니다.
  if (key.startsWith('files/') && INLINE_EXT.test(key)) {
    headers.set('Content-Disposition', 'inline')
  }

  const range = parseRange(req.headers.get('range'), size)
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }

  // Range 요청이면 해당 구간만 206, 아니면 전체 200
  const start = range ? range.start : 0
  const end = range ? range.end : size - 1
  headers.set('Content-Length', String(Math.max(0, end - start + 1)))
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)

  const status = range ? 206 : 200
  if (req.method === 'HEAD' || size === 0) {
    return new Response(null, { status, headers })
  }
  return new Response(streamRange(store, meta, start, end), { status, headers })
}

export const config = {
  path: ['/videos/*', '/files/*'],
}
