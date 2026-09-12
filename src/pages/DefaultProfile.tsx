import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import VoiceSettingsPanel from '../components/VoiceSettingsPanel';

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

  if (loading) {
    return (
      <AppShell activePage="setting">
        <div className="page">불러오는 중...</div>
      </AppShell>
    );
  }

  return (
    <AppShell activePage="setting">
      <div className="page">
        <div className="profile-modal">
          <div className="profile-modal-header">
            <h2>프로필 수정</h2>
          </div>
          <p className="settings-desc">그룹별로 따로 설정하지 않으면 이 프로필이 사용돼요</p>

          <div className="profile-photo-section">
            <div className="profile-photo-preview">
              {avatarUrl ? <img src={avatarUrl} alt="프로필 사진" /> : selectedAvatar}
            </div>
            <div className="profile-photo-actions">
              <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? '업로드 중...' : '사진 업로드'}
              </button>
              {avatarUrl && (
                <button type="button" className="text-danger-button" onClick={handleRemovePhoto}>사진 제거</button>
              )}
            </div>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} hidden />
          </div>

          <div className="profile-avatar-section">
            <div className="profile-section-label">아바타 선택</div>
            <div className="avatar-grid">
              {avatars.map((a) => (
                <button
                  key={a}
                  type="button"
                  className={`avatar-option${!avatarUrl && selectedAvatar === a ? ' is-selected' : ''}`}
                  onClick={() => { setSelectedAvatar(a); setAvatarUrl(null); }}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="profile-field">
            <label htmlFor="nickname">닉네임</label>
            <input
              id="nickname"
              className="profile-input"
              type="text"
              placeholder="닉네임 입력"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={12}
            />
          </div>

          <div className="profile-modal-actions">
            <button type="button" className="secondary-button" onClick={() => navigate('/main')}>메인으로</button>
            <button type="button" className="primary-button" onClick={handleSave} disabled={saving || uploading}>
              {saving ? '저장 중...' : '저장하기'}
            </button>
          </div>
        </div>

        <div className="settings-card" style={{ marginTop: 24 }}>
          <div className="settings-section">
            <h3>음성</h3>
            <p className="settings-desc">마이크와 헤드셋을 고르고 음량을 조절합니다. 장치가 없으면 없음을 선택하세요. 회의방에 그대로 적용됩니다.</p>
            <VoiceSettingsPanel hideHeading />
          </div>
        </div>
      </div>
    </AppShell>
  );
}