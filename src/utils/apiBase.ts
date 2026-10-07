/**
 * 백엔드를 Netlify 함수 + Netlify Blobs 로 쓰는 배포인지 여부.
 * netlify.toml 에서 branch-deploy / deploy-preview 컨텍스트에만 VITE_BACKEND=netlify 를 넣어
 * preview 시연에서만 켜지고, 로컬 개발·기존 Render 배포는 그대로 동작합니다.
 */
export function isNetlifyBackend() {
  return import.meta.env.VITE_BACKEND === 'netlify';
}

/** 배포 시 VITE_API_URL. 없으면 지금 열린 사이트 주소(Vite 프록시)를 씁니다. */
export function getApiBase() {
  // Netlify 백엔드 모드에서는 함수가 같은 사이트(/api/*, /videos/*, /files/*)에 있으므로
  // UI 에 설정된 VITE_API_URL(Render 주소)보다 현재 사이트 주소를 우선합니다.
  if (isNetlifyBackend() && typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }
  const fromEnv = import.meta.env.VITE_API_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }
  return 'http://localhost:3001';
}
