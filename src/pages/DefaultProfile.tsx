import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import { useNavigate } from 'react-router-dom';

const avatars = ['🐱', '🐶', '🐸', '🐼', '🦊', '🐨', '🐯', '🦁', '🐙', '🐬'];
const MAX_FILE_SIZE_MB = 3;

// 앱 전체에서 쓰이는 "기본 프로필" (그룹별로 따로 설정 안 하면 이게 대신 보임)
export default function DefaultProfile() {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🐱');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { navigate('/'); return; }
      setUserId(userData.user.id);

      const { data } = await supabase
        .from('profiles')
        .select('nickname, avatar, avatar_url')
        .eq('id', userData.user.id)
        .maybeSingle();

      if (data) {
        setNickname(data.nickname ?? '');
        setSelectedAvatar(data.avatar ?? '🐱');
        setAvatarUrl(data.avatar_url ?? null);
      }
      setLoading(false);
    };
    fetchProfile();
  }, [navigate]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;

    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드할 수 있어요');
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      alert(`이미지 용량은 ${MAX_FILE_SIZE_MB}MB 이하로 올려주세요`);
      return;
    }

    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${userId}/default-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      alert(`사진 업로드 실패: ${uploadError.message}`);
      setUploading(false);
      return;
    }

    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
    setAvatarUrl(publicUrlData.publicUrl);
    setUploading(false);
  };

  const handleRemovePhoto = () => {
    setAvatarUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSave = async () => {
    if (!nickname.trim()) { alert('닉네임을 입력해주세요'); return; }
    if (!userId) return;

    setSaving(true);
    const { error } = await supabase.from('profiles').upsert({
      id: userId,
      nickname,
      avatar: selectedAvatar,
      avatar_url: avatarUrl,
    });

    setSaving(false);
    if (error) {
      alert(`저장 실패: ${error.message}`);
    } else {
      alert('기본 프로필이 저장되었습니다!');
      navigate('/main');
    }
  };

  if (loading) return <div style={{ padding: '40px', textAlign: 'center' }}>불러오는 중...</div>;

  return (
    <div style={{ maxWidth: '400px', margin: '60px auto', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h2>기본 프로필 설정</h2>
      <p style={{ color: '#888', marginTop: '-8px', marginBottom: '24px', fontSize: '14px' }}>
        그룹별로 따로 설정하지 않으면 이 프로필이 사용돼요
      </p>

      <div style={{ marginBottom: '16px' }}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="프로필 사진"
            style={{ width: '96px', height: '96px', borderRadius: '50%', objectFit: 'cover', marginBottom: '8px', border: '2px solid #3498db' }}
          />
        ) : (
          <div style={{ fontSize: '60px', marginBottom: '8px' }}>{selectedAvatar}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
            style={{ fontSize: '13px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #3498db', background: 'white', color: '#3498db', cursor: 'pointer' }}>
            {uploading ? '업로드 중...' : '📷 사진 업로드'}
          </button>
          {avatarUrl && (
            <button type="button" onClick={handleRemovePhoto}
              style={{ fontSize: '13px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #ddd', background: 'white', color: '#777', cursor: 'pointer' }}>
              사진 제거
            </button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} style={{ display: 'none' }} />
      </div>

      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '12px', color: '#999', marginBottom: '8px' }}>또는 이모지 아바타 선택</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {avatars.map((a) => (
            <button key={a} type="button"
              onClick={() => { setSelectedAvatar(a); setAvatarUrl(null); }}
              style={{
                fontSize: '24px', padding: '6px',
                border: !avatarUrl && selectedAvatar === a ? '2px solid #3498db' : '2px solid transparent',
                borderRadius: '8px',
                background: !avatarUrl && selectedAvatar === a ? '#eaf4fd' : 'transparent',
                cursor: 'pointer',
              }}>
              {a}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <input type="text" placeholder="닉네임 입력" value={nickname} onChange={(e) => setNickname(e.target.value)} maxLength={12}
          style={{ width: '100%', padding: '10px', boxSizing: 'border-box', fontSize: '16px', borderRadius: '6px', border: '1px solid #ddd' }} />
      </div>

      <button onClick={handleSave} disabled={saving || uploading}
        style={{ width: '100%', padding: '12px', backgroundColor: '#3498db', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '6px', fontSize: '16px', marginBottom: '8px' }}>
        {saving ? '저장 중...' : '저장하기'}
      </button>

      <button onClick={() => navigate('/main')}
        style={{ width: '100%', padding: '12px', backgroundColor: '#7f8c8d', color: 'white', border: 'none', cursor: 'pointer', borderRadius: '6px', fontSize: '16px' }}>
        ⬅️ 메인으로
      </button>
    </div>
  );
}