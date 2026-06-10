/** 배포 시 VITE_API_URL, 로컬은 기본값 localhost:3001 */
export function getApiBase() {
  const base = import.meta.env.VITE_API_URL?.trim() || 'http://localhost:3001';
  return base.replace(/\/$/, '');
}
