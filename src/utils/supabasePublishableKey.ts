/**
 * 브라우저에 넣는 Supabase 키인지 확인합니다.
 * 서비스 롤 키는 RLS를 통과하므로 VITE_ 값으로 두면 번들에 실려 테이블이 열립니다.
 */
export function assertPublishableSupabaseKey(key: string) {
  const trimmed = key.trim();
  if (trimmed.startsWith('sb_secret_')) {
    throw new Error('브라우저에는 Supabase anon(publishable) 키만 넣을 수 있습니다. 서비스 롤 키는 서버 .env의 SUPABASE_SERVICE_ROLE_KEY 에만 두세요.');
  }
  const parts = trimmed.split('.');
  if (parts.length !== 3) return;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(padded)) as { role?: string };
    if (json.role === 'service_role') {
      throw new Error('브라우저에는 Supabase anon(publishable) 키만 넣을 수 있습니다. 서비스 롤 키는 서버 .env의 SUPABASE_SERVICE_ROLE_KEY 에만 두세요.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('서비스 롤')) throw err;
  }
}
