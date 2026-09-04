/** 배포 시 VITE_API_URL. 없으면 지금 열린 사이트 주소(Vite 프록시)를 씁니다. */
export function getApiBase() {
  const fromEnv = import.meta.env.VITE_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }
  return 'http://localhost:3001';
}
