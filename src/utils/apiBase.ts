/**
 * 회의 서버 주소.
 * 배포 빌드의 VITE_API_URL 을 쓰고, 없으면 지금 열린 주소나 로컬 3001 을 씁니다.
 * 녹화 영상은 이 서버가 받아 Cloudflare R2 에 넣습니다.
 */
export function getApiBase() {
  const fromEnv = import.meta.env.VITE_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }
  return 'http://localhost:3001';
}
