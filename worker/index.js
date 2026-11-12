/**
 * 공개 사이트 접속을 Supabase server_logs 에 남깁니다.
 * 서비스 롤 키는 Worker 비밀 값으로만 읽고, 브라우저 번들에는 넣지 않습니다.
 * 녹화 목록은 여기서 내려주지 않습니다. 로그인 없이 R2 키가 노출되기 때문입니다.
 * 그룹 화면의 사용량은 meetings 에 기록된 용량으로 계산합니다.
 * 그 외 주소는 기존 화면 파일로 넘깁니다.
 */

/** js·css·이미지처럼 화면이 같이 받는 파일은 로그에서 뺍니다. */
const ASSET_PATH = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|txt|json|webmanifest)$/i;

export default {
  async fetch(request, env, ctx) {
    const started = Date.now();
    const url = new URL(request.url);
    // 용량 조회 분기는 두지 않습니다. 멤버 확인 없이 전체 녹화 키를 돌려주던 경로입니다.
    const response = await env.ASSETS.fetch(request);

    // 어느 PC에서 열어도 페이지·API 접속은 표에 남깁니다. 응답을 기다리지 않게 뒤에서 보냅니다.
    if (shouldLog(url.pathname)) {
      ctx.waitUntil(insertServerLog(env, {
        method: request.method,
        path: url.pathname,
        status: response.status,
        duration_ms: Date.now() - started,
        remote_addr: request.headers.get('cf-connecting-ip'),
        origin: 'external',
        user_id: null,
      }));
    }
    return response;
  },
};

/** 화면 이동과 /api 만 남깁니다. 정적 파일까지 넣으면 한 번 열 때 수십 줄이 쌓입니다. */
function shouldLog(pathname) {
  if (pathname.startsWith('/api/')) return true;
  return !ASSET_PATH.test(pathname);
}

/**
 * server_logs 에 한 줄을 넣습니다.
 * 비밀 키가 없으면 사이트는 그대로 두고 기록만 건너뜁니다.
 */
async function insertServerLog(env, row) {
  const base = String(env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!base || !key) return;
  try {
    await fetch(`${base}/rest/v1/server_logs`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(row),
    });
  } catch {
    // 로그 저장이 실패해도 화면 응답은 이미 만들어 둔 것을 돌려줍니다.
  }
}
