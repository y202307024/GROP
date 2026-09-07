import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabaseClient';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';

const avatars = ['🐱', '🐶', '🐸', '🐼', '🦊', '🐨', '🐯', '🦁', '🐙', '🐬'];
const MAX_FILE_SIZE_MB = 3; // 업로드 사진 최대 용량

export default function GroupProfile() {
  // 라우트: /group/:groupId/profile
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null); // 숨겨진 file input을 코드로 클릭시키기 위한 ref

  const [userId, setUserId] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState('🐱'); // 이모지 아바타
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null); // 업로드한 사진 URL (있으면 이게 우선)
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 진입 시: 로그인 확인 + 이 그룹의 기존 프로필 불러오기
  useEffect(() => {
    const fetchProfile = async () => {
      if (!groupId) {
        alert('그룹 정보가 없습니다.');
        navigate('/main');
        return;
      }

      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        navigate('/');
        return;
      }
      setUserId(userData.user.id);

      // group_profiles 테이블에서 (그룹, 유저) 조합으로 기존 값 조회
      const { data } = await supabase
        .from('group_profiles')
        .select('nickname, avatar, avatar_url')
        .eq('group_id', groupId)
        .eq('user_id', userData.user.id)
        .maybeSingle();

      if (data) {
        setNickname(data.nickname ?? '');
        setSelectedAvatar(data.avatar ?? '🐱');
        setAvatarUrl(data.avatar_url ?? null);
      }
      setLoading(false);
    };
    fetchProfile();
  }, [groupId, navigate]);

  // 파일 선택 시: 검증 → Storage 업로드 → public URL 저장
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId || !groupId) return;

    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드할 수 있어요');
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      alert(`이미지 용량은 ${MAX_FILE_SIZE_MB}MB 이하로 올려주세요`);
      return;
    }

    setUploading(true);

    // 저장 경로: {userId}/{groupId}-{시간값}.{확장자} → 본인 폴더에만 쓰도록 RLS 정책과 일치시킴
    const ext = file.name.split('.').pop();
    const path = `${userId}/${groupId}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (uploadError) {
      alert(`사진 업로드 실패: ${uploadError.message}`);
      setUploading(false);
      return;
    }

    // 업로드 성공하면 공개 URL 가져와서 미리보기에 반영
    const { data: publicUrlData } = supabase.storage
      .from('avatars')
      .getPublicUrl(path);

    setAvatarUrl(publicUrlData.publicUrl);
    setUploading(false);
  };

  // 업로드한 사진 제거 → 다시 이모지 아바타로 전환
  const handleRemovePhoto = () => {
    setAvatarUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // 저장: (group_id, user_id) 기준 upsert → 그룹마다 다른 값 유지됨
  const handleSave = async () => {
    if (!nickname.trim()) {
      alert('닉네임을 입력해주세요');
      return;
    }
    if (!userId || !groupId) return;

    setSaving(true);

    const { error } = await supabase.from('group_profiles').upsert(
      {
        group_id: groupId,
        user_id: userId,
        nickname,
        avatar: selectedAvatar,
        avatar_url: avatarUrl,
      },
      { onConflict: 'group_id,user_id' }
    );

    setSaving(false);
    if (error) {
      alert(`저장 실패: ${error.message}`);
    } else {
      alert('프로필이 저장되었습니다!');
      navigate(`/group/${groupId}`); // 저장 후 그룹 페이지로 복귀
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
          <p className="settings-desc">이 그룹에서만 사용되는 프로필이에요</p>

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
                  onClick={() => {
                    setSelectedAvatar(a);
                    setAvatarUrl(null);
                  }}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="profile-field">
            <label htmlFor="group-nickname">닉네임</label>
            <input
              id="group-nickname"
              className="profile-input"
              type="text"
              placeholder="닉네임 입력"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={12}
            />
          </div>

          <div className="profile-modal-actions">
            <button type="button" className="secondary-button" onClick={() => navigate(`/group/${groupId}`)}>그룹으로</button>
            <button type="button" className="primary-button" onClick={handleSave} disabled={saving || uploading}>
              {saving ? '저장 중...' : '저장하기'}
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}