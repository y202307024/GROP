import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useLocation, useNavigate } from 'react-router-dom';
import { explainAuthError } from '../authErrors';
import { getApiBase } from '../utils/apiBase';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const afterLogin = (location.state as { afterLogin?: string } | null)?.afterLogin;

  useEffect(() => {
    if (!window.location.hash.includes('access_token')) return
    let cancelled = false
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !data.session) return
      navigate(afterLogin || '/main', { replace: true })
    })
    return () => { cancelled = true }
  }, [afterLogin, navigate])

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
  const oauthRedirectTo = `${window.location.origin}/`;

  const rememberOauthOrigin = async () => {
    try {
      await fetch(`${getApiBase()}/api/oauth-origin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin: window.location.origin }),
      })
    } catch {
      // 폴백 서버가 기억 못 해도 로그인은 계속 진행합니다.
    }
  }

  const startOAuth = async (provider: 'google' | 'github', extra?: { scopes?: string; queryParams?: Record<string, string> }) => {
    await rememberOauthOrigin()
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: oauthRedirectTo,
        ...extra,
      },
    })
    if (error) {
      alert(`${provider === 'google' ? '구글' : 'GitHub'} 로그인 실패: ${explainAuthError(error.message)}`)
    }
  }

  const handleGoogleLogin = async () => {
    await startOAuth('google', {
      scopes: 'email profile',
      queryParams: { prompt: 'select_account' },
    })
  }

  const handleGithubLogin = async () => {
    await startOAuth('github', {
      scopes: 'read:user user:email',
    })
  }

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