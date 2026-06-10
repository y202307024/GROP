export function explainAuthError(message: string): string {
  const m = message.toLowerCase();

  if (!message.trim()) {
    return '알 수 없는 오류입니다. Supabase 설정을 확인해 주세요.';
  }
  if (m.includes('password should be at least')) {
    return '비밀번호는 6자 이상이어야 합니다.';
  }
  if (m.includes('rate limit')) {
    return '가입 요청이 너무 많습니다. 10분 정도 기다린 뒤 다시 시도하세요.\n\n개발 중 해결: Supabase → Authentication → Providers → Email → Confirm email 끄기';
  }
  if (m.includes('already registered') || m.includes('already been registered')) {
    return '이미 가입된 이메일입니다. 로그인 화면을 이용해 주세요.';
  }
  if (m.includes('invalid') && m.includes('email')) {
    return '이메일 형식이 올바르지 않습니다. (예: hong@gmail.com)';
  }
  if (m.includes('email not confirmed')) {
    return '이메일 인증이 필요합니다. 메일함의 확인 링크를 누른 뒤 로그인해 주세요.';
  }
  if (m.includes('invalid login credentials')) {
    return '이메일 또는 비밀번호가 맞지 않습니다.';
  }
  if (m.includes('signup is disabled') || m.includes('signups not allowed')) {
    return 'Supabase에서 회원가입이 꺼져 있습니다. Authentication → Providers → Email을 켜 주세요.';
  }
  if (m.includes('unregistered api key') || m.includes('invalid api key') || m.includes('jwt')) {
    return (
      'Supabase API 키가 등록되지 않았거나 잘못됐습니다.\n\n' +
      'Supabase 대시보드 → Project Settings → API 에서\n' +
      '• Project URL\n' +
      '• anon public 키 (eyJ... 로 시작하는 긴 문자열)\n' +
      '을 복사해 .env.local에 넣고 dev 서버를 재시작하세요.\n\n' +
      'sb_publishable_ 키가 안 되면 anon public (JWT) 키를 쓰세요.'
    );
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return (
      'Supabase 서버에 연결하지 못했습니다.\n\n' +
      '1) .env.local의 VITE_SUPABASE_URL이 맞는지 확인 (삭제된 프로젝트면 DNS 오류)\n' +
      '2) Supabase 대시보드 → Project Settings → API에서 URL/anon key 다시 복사\n' +
      '3) npm run dev 재시작'
    );
  }

  return message;
}

export function isSupabaseEnvConfigured(): boolean {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return false;
  if (url.includes('YOUR_PROJECT')) return false;
  if (key.includes('xxx') || key.includes('복사') || key.includes('키')) return false;
  return url.startsWith('https://') && key.length > 20;
}
