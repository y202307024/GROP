import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { explainAuthError, isSupabaseEnvConfigured } from '../authErrors';
import { startOAuth } from '../utils/oauthLogin';

/**
 * 회원가입 페이지
 * grop/signup.html 의 클래스명과 css/signup.css 를 그대로 사용합니다.
 */
export default function SignUp() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [org, setOrg] = useState('');
  const [agree, setAgree] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const navigate = useNavigate();

  const envOk = isSupabaseEnvConfigured();
  const isSuccess = errorText.includes('완료');

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');

    if (!envOk) {
      setErrorText('Supabase 연결 설정이 안 됐습니다.\n.env.local 파일의 URL/키를 확인하고 npm run dev를 다시 실행하세요.');
      return;
    }
    if (!agree) {
      setErrorText('이용약관 및 개인정보 처리방침에 동의해 주세요.');
      return;
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@') || trimmedEmail.length < 5) {
      setErrorText('올바른 이메일을 입력해 주세요. (예: hong@gmail.com)');
      return;
    }
    if (password.length < 6) {
      setErrorText('비밀번호는 6자 이상이어야 합니다.');
      return;
    }
    if (password !== passwordConfirm) {
      setErrorText('비밀번호가 일치하지 않습니다.');
      return;
    }

    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: {
          emailRedirectTo: window.location.origin,
          data: {
            full_name: name.trim() || undefined,
            organization: org.trim() || undefined,
          },
        },
      });

      if (signUpError) {
        const msg = explainAuthError(signUpError.message);
        setErrorText(`회원가입 실패\n${msg}${signUpError.status ? `\n(코드: ${signUpError.status})` : ''}`);
        return;
      }

      if (data.user?.identities?.length === 0) {
        setErrorText('이미 가입된 이메일입니다. 로그인 화면을 이용해 주세요.');
        return;
      }

      if (data.session) {
        navigate('/setup-profile');
        return;
      }

      setErrorText(
        '가입 요청은 완료됐습니다.\n\n' +
          '이메일 인증이 켜져 있으면 메일함의 확인 링크를 누른 뒤 로그인하세요.\n' +
          '메일이 안 오면 Supabase → Authentication → Providers → Email → Confirm email 을 끄세요.',
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setErrorText(`회원가입 실패\n${explainAuthError(message)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="signup-shell stage">
      <section className="signup-left">
        <h1 className="brand">GROP</h1>
        <h2 className="headline">
          팀의 아이디어<br />
          기록하고 성장시키세요
        </h2>
        <p className="subtext">
          화이트보드 협업부터 AI요약, 문서화까지<br />
          GROP 하나로 스마트한 회의를 완성하세요.
        </p>
        <p className="login-footer">
          이미 계정이 있으신가요?
          <Link to="/">로그인</Link>
        </p>
      </section>

      <section className="signup-right">
        <h1>회원가입</h1>
        <p className="subtitle">계정을 만들고 GROP의 모든 기능을 경험해보세요.</p>

        <div className="social-row">
          <button
            type="button"
            className="btn btn-google"
            onClick={() => startOAuth('google', { scopes: 'email profile', queryParams: { prompt: 'select_account' } })}
            disabled={loading}
          >
            <span className="google-g">G</span>
            Google로 회원가입
          </button>
          <button
            type="button"
            className="btn btn-github"
            onClick={() => startOAuth('github', { scopes: 'read:user user:email' })}
            disabled={loading}
          >
            GitHub로 회원가입
          </button>
        </div>

        <div className="divider">또는</div>

        <form onSubmit={handleSignUp}>
          <div className="field">
            <label htmlFor="name">이름</label>
            <input id="name" type="text" placeholder="이름을 입력하세요" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="email">이메일</label>
            <input id="email" type="email" placeholder="이메일 주소를 입력하세요" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <input id="password" type="password" placeholder="비밀번호를 입력하세요" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            <p className={`helper${password.length > 0 && password.length < 6 ? ' is-error' : ''}`}>6자 이상 입력해주세요.</p>
          </div>
          <div className="field">
            <label htmlFor="password-confirm">비밀번호 확인</label>
            <input id="password-confirm" type="password" placeholder="비밀번호를 다시 입력하세요" value={passwordConfirm} onChange={(e) => setPasswordConfirm(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="org">소속 (선택)</label>
            <input id="org" type="text" placeholder="학교 또는 회사명을 입력하세요" value={org} onChange={(e) => setOrg(e.target.value)} />
          </div>

          <div className="agree-row">
            <input type="checkbox" id="agree" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            <label htmlFor="agree">서비스 이용약관 및 개인정보 처리방침에 동의합니다.</label>
          </div>

          <p className={`signup-message${isSuccess ? ' is-success' : ''}`}>{errorText}</p>

          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? '가입 중…' : '회원가입 완료하기'}
          </button>
          <p className="fine-print">가입하면 GROP의 이용약관 및 개인정보 처리방침에 동의하게 됩니다.</p>
        </form>
      </section>
    </div>
  );
}
