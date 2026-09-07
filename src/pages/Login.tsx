import React, { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { explainAuthError } from '../authErrors';
import { startOAuth } from '../utils/oauthLogin';
import Icon from '../components/Icon';

/**
 * 로그인 페이지
 * grop/login.html 의 클래스명과 css/login.css 를 그대로 사용합니다.
 */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const afterLogin = (location.state as { afterLogin?: string } | null)?.afterLogin;

  useEffect(() => {
    if (!window.location.hash.includes('access_token')) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled || !data.session) return;
      navigate(afterLogin || '/main', { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [afterLogin, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setMessage(`로그인 실패: ${explainAuthError(error.message)}`);
    } else {
      navigate(afterLogin || '/main');
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setMessage('비밀번호 재설정을 위해 이메일을 먼저 입력해 주세요.');
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/`,
    });
    setMessage(error ? explainAuthError(error.message) : '비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해 주세요.');
  };

  return (
    <div className="login-shell stage">
      <section className="hero">
        <div className="hero-content">
          <h1 className="brand">GROP</h1>
          <h2 className="tagline">
            Focus on Discussion,<br />
            We Handle the Notes
          </h2>
          <p className="desc">
            회의의 모든 내용을 자동으로 정리하고<br />
            문서를 생성하여 협업 효율을 높여보세요.
          </p>
        </div>

        <div className="features">
          <div className="feature-card">
            <Icon name="sparkles" />
            <h3>AI 회의 요약</h3>
            <p>회의 내용을 AI 분석 및<br />핵심내용 요약</p>
          </div>
          <div className="feature-card">
            <Icon name="file-text" />
            <h3>문서 자동 생성</h3>
            <p>회의록 문서<br />자동 생성</p>
          </div>
          <div className="feature-card">
            <Icon name="users" />
            <h3>팀 협업</h3>
            <p>실시간 회의 공유</p>
          </div>
          <div className="feature-card">
            <Icon name="file-text" />
            <h3>회의 기록 관리</h3>
            <p>모든 회의 기록<br />저장 및 관리</p>
          </div>
        </div>
      </section>

      <aside className="login-panel">
        <h1>로그인</h1>
        <p className="subtitle">GROP에 오신 것을 환영합니다!</p>

        <form onSubmit={handleLogin}>
          <div className="field">
            <label htmlFor="email">이메일</label>
            <input
              id="email"
              type="email"
              placeholder="이메일을 입력하세요"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              type="password"
              placeholder="비밀번호를 입력하세요"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="row-between">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              로그인 상태 유지
            </label>
            <button type="button" className="forgot-link" onClick={handleForgotPassword}>
              비밀번호 찾기
            </button>
          </div>

          <p className="login-message">{message}</p>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '로그인 중...' : '로그인'}
          </button>

          <div className="divider">또는</div>

          <button
            type="button"
            className="btn btn-google"
            onClick={() => startOAuth('google', { scopes: 'email profile', queryParams: { prompt: 'select_account' } })}
            disabled={loading}
          >
            <span className="google-g">G</span>
            Google로 로그인
          </button>
          <button
            type="button"
            className="btn btn-github"
            onClick={() => startOAuth('github', { scopes: 'read:user user:email' })}
            disabled={loading}
          >
            GitHub로 로그인
          </button>

          <p className="signup">
            계정이 없으신가요?
            <Link to="/signup">회원가입</Link>
          </p>
        </form>
      </aside>
    </div>
  );
}
