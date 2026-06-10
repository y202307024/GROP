import React, { useState } from 'react';
import { supabase } from '../supabaseClient';
import { useNavigate } from 'react-router-dom';
import { explainAuthError, isSupabaseEnvConfigured } from '../authErrors';

export default function SignUp() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState('');
  const navigate = useNavigate();

  const envOk = isSupabaseEnvConfigured();

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorText('');

    if (!envOk) {
      setErrorText('Supabase 연결 설정이 안 됐습니다.\n.env.local 파일의 URL/키를 확인하고 npm run dev를 다시 실행하세요.');
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

    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: trimmedEmail,
        password,
        options: { emailRedirectTo: window.location.origin },
      });

      if (signUpError) {
        console.error('signUp error:', signUpError);
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
      console.error('signUp exception:', err);
      const message = err instanceof Error ? err.message : String(err);
      setErrorText(`회원가입 실패\n${explainAuthError(message)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '360px', margin: '100px auto', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h2>회원가입 화면</h2>

      {!envOk ? (
        <div
          style={{
            marginBottom: '12px',
            padding: '10px',
            background: '#fff3cd',
            color: '#856404',
            borderRadius: '6px',
            fontSize: '13px',
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
          }}
        >
          Supabase 설정이 비어 있거나 placeholder입니다.
          {'\n'}.env.local 확인 후 dev 서버를 재시작하세요.
        </div>
      ) : null}

      {errorText ? (
        <div
          style={{
            marginBottom: '12px',
            padding: '10px',
            background: errorText.includes('완료') ? '#e8f5e9' : '#fdecea',
            color: errorText.includes('완료') ? '#2e7d32' : '#c62828',
            borderRadius: '6px',
            fontSize: '13px',
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
          }}
        >
          {errorText}
        </div>
      ) : null}

      <form onSubmit={handleSignUp}>
        <div style={{ marginBottom: '10px' }}>
          <input
            type="email"
            placeholder="이메일 (예: hong@gmail.com)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <input
            type="password"
            placeholder="비밀번호 (6자 이상)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }}
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          style={{ width: '100%', padding: '10px', backgroundColor: '#008CBA', color: 'white', border: 'none', cursor: 'pointer', marginBottom: '8px' }}
        >
          {loading ? '가입 중…' : '회원가입 완료하기'}
        </button>
        <button
          type="button"
          onClick={() => navigate('/')}
          style={{ width: '100%', padding: '10px', backgroundColor: '#7f8c8d', color: 'white', border: 'none', cursor: 'pointer' }}
        >
          ⬅️ 로그인으로 돌아가기
        </button>
      </form>
    </div>
  );
}
