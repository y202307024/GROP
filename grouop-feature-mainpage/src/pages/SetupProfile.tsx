import { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { useNavigate } from 'react-router-dom';

const avatars = ['🐱','🐶','🐸','🐼','🦊','🐨','🐯','🦁','🐙','🐬'];

export default function SetupProfile() {
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🐱');
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) { alert('닉네임을 입력해주세요'); return; }

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;

    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId, nickname, avatar: selectedAvatar });

    if (error) {
      alert(`프로필 저장 실패: ${error.message}`);
    } else {
      navigate('/main');
    }
  };

  return (
    <div style={{ maxWidth: '400px', margin: '60px auto', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h2>프로필 설정</h2>
      <p style={{ color: '#888', marginBottom: '24px' }}>처음 오셨군요! 프로필을 설정해주세요 👋</p>

      <form onSubmit={handleSubmit}>
        {/* 아바타 선택 */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '60px', marginBottom: '12px' }}>{selectedAvatar}</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
            {avatars.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setSelectedAvatar(a)}
                style={{
                  fontSize: '24px', padding: '6px', border: selectedAvatar === a ? '2px solid #3498db' : '2px solid transparent',
                  borderRadius: '8px', background: selectedAvatar === a ? '#eaf4fd' : 'transparent', cursor: 'pointer'
                }}
              >{a}</button>
            ))}
          </div>
        </div>

        {/* 닉네임 */}
        <div style={{ marginBottom: '16px' }}>
          <input
            type="text" placeholder="닉네임 입력" value={nickname}
            onChange={(e) => setNickname(e.target.value)} required maxLength={12}
            style={{ width: '100%', padding: '10px', boxSizing: 'border-box', fontSize: '16px', borderRadius: '6px', border: '1px solid #ddd' }}
          />
        </div>

        <button type="submit"
          style={{ width: '100%', padding: '12px', backgroundColor: '#3498db', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '6px', fontSize: '16px' }}>
          시작하기 🚀
        </button>
      </form>
    </div>
  );
}