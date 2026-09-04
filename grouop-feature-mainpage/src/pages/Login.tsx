import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      alert(`로그인 실패: ${error.message}`);
    } else {
      alert('로그인 성공했습니다!');
      navigate('/main');
    }
  };

  return (
    <div style={{ maxWidth: '300px', margin: '100px auto', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h2>로그인</h2>
      <form onSubmit={handleLogin}>
        <div style={{ marginBottom: '10px' }}>
          <input type="email" placeholder="이메일 입력" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }} />
        </div>
        <div style={{ marginBottom: '10px' }}>
          <input type="password" placeholder="비밀번호 입력" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: '100%', padding: '10px', boxSizing: 'border-box' }} />
        </div>
        <button type="submit" style={{ width: '100%', padding: '10px', backgroundColor: '#4CAF50', color: 'white', border: 'none', cursor: 'pointer', marginBottom: '8px' }}>
          로그인하기
        </button>
        <button type="button" onClick={() => navigate('/signup')} style={{ width: '100%', padding: '10px', backgroundColor: '#e74c3c', color: 'white', border: 'none', cursor: 'pointer' }}>
          회원가입 하러가기 ➡️
        </button>
      </form>
    </div>
  );
}