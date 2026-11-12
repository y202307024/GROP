import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

// HTTP IP는 마이크가 막히므로 HTTPS를 씁니다.
// mkcert가 이 PC 신뢰 저장소에 로컬 CA를 넣어, "안전하지 않음" 경고를 없앱니다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // 서비스 롤 키는 RLS를 통과합니다. VITE_ 이름이면 브라우저 번들에 들어갑니다.
  if (env.VITE_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('VITE_SUPABASE_SERVICE_ROLE_KEY 는 브라우저에 들어가면 안 됩니다. 서버 .env 의 SUPABASE_SERVICE_ROLE_KEY 만 사용하세요.')
  }

  return {
    envPrefix: 'VITE_',
    plugins: [
      react(),
      mkcert({
        hosts: ['localhost', '127.0.0.1'],
      }),
    ],
    server: {
      // mkcert 플러그인이 인증서를 붙입니다. Vite 타입상 boolean 대신 객체를 씁니다.
      https: {},
      // Cloudflare 터널 주소는 매번 바뀌므로 호스트 검사를 열어 둡니다.
      host: true,
      allowedHosts: true,
      proxy: {
        '/api': 'http://127.0.0.1:3001',
        '/videos': 'http://127.0.0.1:3001',
        '/files': 'http://127.0.0.1:3001',
        '/health': 'http://127.0.0.1:3001',
      },
    },
  }
})
