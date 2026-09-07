import { supabase } from '../supabaseClient';
import { explainAuthError } from '../authErrors';
import { getApiBase } from './apiBase';

/**
 * 소셜 로그인 시작 유틸
 * - Login / SignUp 이 같은 OAuth 흐름을 쓰도록 모읍니다.
 * - extra: Google 계정 선택 프롬프트 등 provider별 옵션
 */
export async function startOAuth(
  provider: 'google' | 'github',
  extra?: { scopes?: string; queryParams?: Record<string, string> },
) {
  try {
    await fetch(`${getApiBase()}/api/oauth-origin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: window.location.origin }),
    });
  } catch {
    // 폴백 서버가 기억 못 해도 로그인은 계속 진행합니다.
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/`,
      ...extra,
    },
  });

  if (error) {
    alert(`${provider === 'google' ? '구글' : 'GitHub'} 로그인 실패: ${explainAuthError(error.message)}`);
  }
}
