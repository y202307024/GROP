import { supabase } from '../services/supabaseClient';

/**
 * 서버가 Supabase로 다시 확인할 로그인 토큰 헤더.
 * 여기서 읽은 토큰은 신원 증명으로 쓰지 않고, 서버의 requireUser 가 확인합니다.
 * extra: Content-Type 처럼 함께 보낼 헤더. 토큰이 없으면 Authorization 은 빠집니다.
 */
export async function bearerHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return extra;
  return { ...extra, Authorization: `Bearer ${token}` };
}

/**
 * 이 브라우저에 로그인 세션이 있을 때만 사용자 id를 돌려줍니다.
 * getUser()는 세션이 없으면 AuthSessionMissingError를 만들기 때문에,
 * 로그인 전 확인은 로컬 세션만 보고 끝냅니다.
 */
export async function signedInUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user) return null;
  return data.session.user.id;
}
