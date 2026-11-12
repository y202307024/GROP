const fs = require('fs')
const path = require('path')

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args))

/** 이 서버 디스크에 남기는 요청 기록. 토큰·본문은 넣지 않습니다. */
const LOG_DIR = path.resolve(__dirname, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'access.log')
const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

fs.mkdirSync(LOG_DIR, { recursive: true })

let supabaseWarned = false

function isLoopbackAddress(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function warnSupabaseOnce(message) {
  if (supabaseWarned) return
  supabaseWarned = true
  console.warn(message)
}

/**
 * 요청 한 줄을 Supabase server_logs 에 넣습니다.
 * 서비스 롤 키로만 쓰고, 실패해도 응답은 이미 끝난 뒤라 요청에는 영향을 주지 않습니다.
 */
async function insertServerLog(row) {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!url || !service) {
    warnSupabaseOnce('서버 로그를 Supabase에 남기려면 .env 에 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.')
    return
  }
  try {
    const res = await fetch(`${url}/rest/v1/server_logs`, {
      method: 'POST',
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      warnSupabaseOnce(`서버 로그를 Supabase에 남기지 못했습니다 (${res.status}). supabase/20_서버로그.sql 을 실행했는지 확인해 주세요. ${detail}`)
    }
  } catch (err) {
    warnSupabaseOnce(`서버 로그를 Supabase에 남기지 못했습니다: ${err.message}`)
  }
}

/**
 * 요청이 끝난 뒤 한 줄을 콘솔, 파일, Supabase에 남깁니다.
 * 헬스체크는 배포 서버가 자주 호출하므로 표에는 넣지 않습니다.
 */
function requestLogger(req, res, next) {
  const started = Date.now()
  res.on('finish', () => {
    // 로그인하지 않은 요청의 401은 예상된 응답이라 콘솔·파일·Supabase 로그에 남기지 않습니다.
    if (res.statusCode === 401 && req.anonymousAuth) return
    const addr = req.socket?.remoteAddress || ''
    const where = isLoopbackAddress(addr) ? 'internal' : 'external'
    const userId = USER_ID_RE.test(req.authUser?.id || '') ? req.authUser.id : null
    const pathName = req.path || req.url || ''
    const durationMs = Date.now() - started
    const line = [
      new Date().toISOString(),
      req.method,
      pathName,
      String(res.statusCode),
      `${durationMs}ms`,
      addr || '-',
      where,
      `user=${userId || '-'}`,
    ].join(' ')
    console.log(line)
    fs.appendFile(LOG_FILE, `${line}\n`, () => {
      // 파일 기록이 실패해도 응답은 이미 끝났습니다.
    })
    if (pathName === '/health') return
    void insertServerLog({
      method: req.method,
      path: pathName,
      status: res.statusCode,
      duration_ms: durationMs,
      remote_addr: addr || null,
      origin: where,
      user_id: userId,
    })
  })
  next()
}

module.exports = {
  LOG_FILE,
  requestLogger,
}
