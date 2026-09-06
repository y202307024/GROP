const http = require('http')
const os = require('os')

let lastOauthOrigin = ''

function lanAppOrigin() {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return `https://${addr.address}:5173`
      }
    }
  }
  return 'https://localhost:5173'
}

function defaultOauthTarget() {
  return (process.env.OAUTH_REDIRECT_TARGET || lanAppOrigin()).replace(/\/$/, '')
}

function isSafeAppOrigin(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    const host = url.hostname
    if (host === 'localhost' || host === '127.0.0.1') return true
    if (host.endsWith('.trycloudflare.com') || host.endsWith('.ngrok-free.app') || host.endsWith('.ngrok.io')) return true
    const parts = host.split('.').map(Number)
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
    if (parts[0] === 10) return true
    if (parts[0] === 192 && parts[1] === 168) return true
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true
    return false
  } catch {
    return false
  }
}

function rememberOauthOrigin(origin) {
  if (!isSafeAppOrigin(origin)) return lastOauthOrigin || defaultOauthTarget()
  lastOauthOrigin = origin.replace(/\/$/, '')
  return lastOauthOrigin
}

function getOauthOrigin() {
  return lastOauthOrigin || defaultOauthTarget()
}

/**
 * Supabase Site URL이 http://localhost:3000 으로 남아 있으면
 * 구글/깃허브 로그인 후 토큰이 3000으로 돌아옵니다.
 * 로그인 시작 때 기억한 주소(네트워크 IP)로 되돌립니다.
 */
function startOauthFallback() {
  const port = Number(process.env.OAUTH_FALLBACK_PORT || 3000)

  const server = http.createServer((req, res) => {
    const target = getOauthOrigin()
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <title>로그인 이동</title>
</head>
<body style="font-family:sans-serif;padding:48px;text-align:center;color:#333">
  <p>로그인 정보를 앱으로 옮기는 중입니다...</p>
  <script>
    var fallback = ${JSON.stringify(target)};
    var path = location.pathname && location.pathname !== '/' ? location.pathname : '/';
    fetch('http://127.0.0.1:3001/api/oauth-origin')
      .then(function (res) { return res.json(); })
      .then(function (data) { return (data && data.origin) || fallback; })
      .catch(function () { return fallback; })
      .then(function (origin) {
        location.replace(origin + path + location.search + location.hash);
      });
  </script>
</body>
</html>`
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    })
    res.end(html)
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`OAuth 폴백: 포트 ${port}가 이미 사용 중입니다.`)
      return
    }
    console.error('OAuth 폴백 오류:', err.message)
  })

  server.listen(port, '127.0.0.1', () => {
    console.log(`OAuth 폴백: http://127.0.0.1:${port} → ${getOauthOrigin()}`)
  })
}

module.exports = {
  startOauthFallback,
  rememberOauthOrigin,
  getOauthOrigin,
  isSafeAppOrigin,
}
