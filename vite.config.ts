import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
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
