/**
 * 로그인 세션 저장소.
 * 기본은 sessionStorage라 새로고침에는 남고, 브라우저(탭)를 닫으면 사라집니다.
 * "로그인 상태 유지"를 켠 경우에만 localStorage에 둡니다.
 */
const REMEMBER_KEY = 'grop.rememberLogin';

/** 비밀번호 로그인 직전에 호출합니다. 켜면 브라우저를 닫아도 세션이 남습니다. */
export function setRememberLogin(remember: boolean) {
  try {
    if (remember) localStorage.setItem(REMEMBER_KEY, '1');
    else localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // 저장이 막히면 이번 탭에만 세션을 둡니다.
  }
}

function remembered() {
  try {
    return localStorage.getItem(REMEMBER_KEY) === '1';
  } catch {
    return false;
  }
}

function activeStore(): Storage | null {
  if (typeof window === 'undefined') return null;
  return remembered() ? window.localStorage : window.sessionStorage;
}

/** 예전 방식(항상 localStorage)으로 남은 토큰은, 유지를 켜지 않았으면 지웁니다. */
function dropUnrememberedLocalSession() {
  if (typeof window === 'undefined' || remembered()) return;
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith('sb-') && key.includes('auth-token')) stale.push(key);
    }
    for (const key of stale) localStorage.removeItem(key);
  } catch {
    // 시크릿 모드 등에서 저장소를 못 읽어도 로그인은 계속됩니다.
  }
}

dropUnrememberedLocalSession();

/**
 * Supabase 세션 저장소.
 * 유지가 꺼져 있으면 같은 키를 localStorage에 남기지 않습니다.
 */
export const browserAuthStorage = {
  getItem(key: string) {
    try {
      return activeStore()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  },
  setItem(key: string, value: string) {
    try {
      const store = activeStore();
      if (!store) return;
      const other = remembered() ? sessionStorage : localStorage;
      other.removeItem(key);
      store.setItem(key, value);
    } catch {
      // 용량이 가득 차도 화면의 로그인 오류 처리에 맡깁니다.
    }
  },
  removeItem(key: string) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      // 로그아웃으로 세션 키가 지워지면 유지 표시도 함께 끕니다.
      if (key.startsWith('sb-') && key.includes('auth-token') && !key.includes('code-verifier')) {
        localStorage.removeItem(REMEMBER_KEY);
      }
    } catch {
      // 이미 없어도 로그아웃은 끝난 것으로 봅니다.
    }
  },
};
