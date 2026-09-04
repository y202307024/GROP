import React, { useEffect, useRef, useState } from 'react';
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
  const oneTapContainerRef = useRef<HTMLDivElement>(null);

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

  // 버튼으로 이동하는 기존 구글 로그인 (팝업 방식이 막힐 때의 대안으로 유지)
  const handleGoogleLoginRedirect = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}${afterLogin || '/main'}`,
      },
    });
    if (error) {
      alert(`구글 로그인 실패: ${explainAuthError(error.message)}`);
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

      // 화면 오른쪽 위에 자동 팝업 (One Tap)
      window.google.accounts.id.prompt();

      // 원한다면 버튼 형태로도 렌더링 가능 (원탭이 안 뜰 때 대비용)
      if (oneTapContainerRef.current) {
        window.google.accounts.id.renderButton(oneTapContainerRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          width: 280,
        });
      }
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

      {/* 구글 원탭이 자동으로 안 뜨는 경우를 대비한 버튼 */}
      <div ref={oneTapContainerRef} style={{ display: 'flex', justifyContent: 'center', marginBottom: '8px' }} />

      <button
        type="button"
        onClick={handleGoogleLoginRedirect}
        style={{
          width: '100%',
          padding: '10px',
          backgroundColor: '#fff',
          color: '#333',
          border: '1px solid #ccc',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        구글 계정으로 로그인 (이동 방식)
      </button>
    </div>
  );
}