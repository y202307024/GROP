import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

// HTTP IP는 마이크가 막히므로 HTTPS를 씁니다.
// mkcert가 이 PC 신뢰 저장소에 로컬 CA를 넣어, "안전하지 않음" 경고를 없앱니다.
export default defineConfig({
  plugins: [
    react(),
    mkcert({
      hosts: ['localhost', '127.0.0.1'],
    }),
  ],
  server: {
    https: true,
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
})
