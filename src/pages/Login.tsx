import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useLocation, useNavigate } from 'react-router-dom';
import { explainAuthError } from '../authErrors';

declare global {
  interface Window {
    google?: any;
  }
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const afterLogin = (location.state as { afterLogin?: string } | null)?.afterLogin;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      alert(`로그인 실패: ${explainAuthError(error.message)}`);
    } else {
      alert('로그인 성공했습니다!');
      navigate(afterLogin || '/main');
    }
  };

  // 로그인 후 돌아갈 주소. 초대 링크로 온 경우 afterLogin을 유지합니다.
  const oauthRedirectTo = `${window.location.origin}${afterLogin || '/main'}`;

  // Google Identity Services + Supabase OAuth. 같은 탭에서 구글 계정 선택 화면으로 이동합니다.
  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: oauthRedirectTo,
        scopes: 'email profile',
        queryParams: {
          prompt: 'select_account',
        },
      },
    });
    if (error) {
      alert(`구글 로그인 실패: ${explainAuthError(error.message)}`);
    }
  };

  // GitHub는 원탭이 없어서 Supabase OAuth 리다이렉트만 사용합니다.
  const handleGithubLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: oauthRedirectTo,
        // 이메일·프로필을 받으려면 GitHub OAuth 앱에도 같은 scope가 열려 있어야 합니다.
        scopes: 'read:user user:email',
      },
    });
    if (error) {
      alert(`GitHub 로그인 실패: ${explainAuthError(error.message)}`);
    }
  };

  // 구글 원탭에서 ID 토큰을 받았을 때 Supabase 세션 생성
  const handleCredentialResponse = async (response: { credential: string }) => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: response.credential,
    });
    setLoading(false);

    if (error) {
      console.error('One Tap 로그인 실패:', error);
      alert(`구글 로그인 실패: ${explainAuthError(error.message)}`);
    } else {
      navigate(afterLogin || '/main');
    }
  };

  useEffect(() => {
    // 이미 로그인된 세션이 있으면 원탭을 띄우지 않음
    let cancelled = false;

    const initOneTap = async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled || data.session) return;

      const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
      if (!clientId) {
        console.warn('VITE_GOOGLE_CLIENT_ID가 설정되지 않았습니다.');
        return;
      }

      // Google Identity Services 스크립트 로드
      const scriptId = 'google-identity-script';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => setupOneTap(clientId);
        document.head.appendChild(script);
      } else {
        setupOneTap(clientId);
      }
    };

    const setupOneTap = (clientId: string) => {
      if (!window.google || cancelled) return;

      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredentialResponse,
        use_fedcm_for_prompt: true, // 크롬 최신 정책 대응
      });

      // 화면 오른쪽 위에 자동 팝업 (One Tap). 버튼은 아래 구글 로그인 하나만 둡니다.
      window.google.accounts.id.prompt();
    };

    initOneTap();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ maxWidth: '300px', margin: '100px auto', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h2>로그인</h2>
      <form onSubmit={handleLogin}>
        <div style={{ marginBottom: '10px' }}>
          <input
            type="email"
            placeholder="이메일 입력"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <input
            type="password"
            placeholder="비밀번호 입력"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            cursor: loading ? 'not-allowed' : 'pointer',
            marginBottom: '8px',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? '로그인 중...' : '로그인하기'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/signup')}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: '#e74c3c',
            color: 'white',
            border: 'none',
            cursor: 'pointer',
            marginBottom: '8px',
          }}
        >
          회원가입 하러가기 ➡️
        </button>
      </form>

      <div style={{ margin: '16px 0', color: '#888', fontSize: '14px' }}>또는</div>

      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={loading}
        style={{
          width: '100%',
          padding: '10px',
          backgroundColor: '#fff',
          color: '#333',
          border: '1px solid #ccc',
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer',
          marginBottom: '8px',
          opacity: loading ? 0.7 : 1,
        }}
      >
        구글 계정으로 로그인
      </button>

      <button
        type="button"
        onClick={handleGithubLogin}
        disabled={loading}
        style={{
          width: '100%',
          padding: '10px',
          backgroundColor: '#24292f',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.7 : 1,
        }}
      >
        GitHub 계정으로 로그인
      </button>
    </div>
  );
}