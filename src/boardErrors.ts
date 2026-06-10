export function explainBoardError(message: string): string {
  const m = message.toLowerCase();

  if (
    (m.includes('relation') && m.includes('boards') && m.includes('does not exist')) ||
    m.includes('could not find the table') ||
    m.includes('schema cache')
  ) {
    return (
      'boards 테이블이 없습니다.\n\n' +
      'Supabase 대시보드 → SQL Editor → supabase/whiteboard.sql 전체 실행 후 새로고침하세요.'
    );
  }
  if (m.includes('unregistered api key') || m.includes('invalid api key')) {
    return 'Supabase API 키가 잘못됐습니다. .env.local의 anon public 키(eyJ...)를 확인하세요.';
  }
  if (m.includes('row-level security') || m.includes('rls')) {
    return '로그인이 필요합니다. 로그아웃 상태면 먼저 로그인한 뒤 다시 시도해 주세요.';
  }
  if (m.includes('jwt') || m.includes('not authenticated')) {
    return '로그인 세션이 만료됐습니다. 다시 로그인해 주세요.';
  }
  if (m.includes('permission denied')) {
    return 'DB 권한이 없습니다. Supabase에서 whiteboard.sql의 RLS 정책을 실행했는지 확인해 주세요.';
  }

  return message;
}
