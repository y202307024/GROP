import { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { useNavigate } from 'react-router-dom';

const avatars = ['🐱','🐶','🐸','🐼','🦊','🐨','🐯','🦁','🐙','🐬'];

export default function Profile() {
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🐱');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { navigate('/'); return; }

      const { data } = await supabase
        .from('profiles')
        .select('nickname, avatar')
        .eq('id', userData.user.id)
        .single();

      if (data) {
        setNickname(data.nickname ?? '');
        setSelectedAvatar(data.avatar ?? '🐱');
      }
      setLoading(false);
    };
    fetchProfile();
  }, []);

  const handleSave = async () => {
    if (!nickname.trim()) { alert('닉네임을 입력해주세요'); return; }
    setSaving(true);

    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userData.user?.id, nickname, avatar: selectedAvatar });

    setSaving(false);
    if (error) {
      alert(`저장 실패: ${error.message}`);
    } else {
      alert('프로필이 저장되었습니다!');
      navigate('/main');
    }
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>불러오는 중...</div>;

  return (
    <div style={{ maxWidth: '400px', margin: '60px auto', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h2>프로필 수정</h2>

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
                fontSize: '24px', padding: '6px',
                border: selectedAvatar === a ? '2px solid #3498db' : '2px solid transparent',
                borderRadius: '8px',
                background: selectedAvatar === a ? '#eaf4fd' : 'transparent',
                cursor: 'pointer'
              }}
            >{a}</button>
          ))}
        </div>
      </div>

      {/* 닉네임 */}
      <div style={{ marginBottom: '16px' }}>
        <input
          type="text" placeholder="닉네임 입력" value={nickname}
          onChange={(e) => setNickname(e.target.value)} maxLength={12}
          style={{ width: '100%', padding: '10px', boxSizing: 'border-box', fontSize: '16px', borderRadius: '6px', border: '1px solid #ddd' }}
        />
      </div>

      <button
        onClick={handleSave} disabled={saving}
        style={{ width: '100%', padding: '12px', backgroundColor: '#3498db', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '6px', fontSize: '16px', marginBottom: '8px' }}>
        {saving ? '저장 중...' : '저장하기'}
      </button>

      <button
        onClick={() => navigate('/main')}
        style={{ width: '100%', padding: '12px', backgroundColor: '#7f8c8d', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '6px', fontSize: '16px' }}>
        ⬅️ 메인으로
      </button>
    </div>
  );
}