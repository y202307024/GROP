import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabaseClient';
import Icon from './Icon';
import { AVATAR_OPTIONS, DEFAULT_AVATAR_KEY, getAvatarSrc } from '../utils/avatarOptions';

const MAX_FILE_SIZE_MB = 3;

type Props = {
  open: boolean;
  onClose: () => void;
  /** 저장 성공 시 최신 아바타(프리셋 key 또는 업로드 사진 URL)를 상위(AppShell 상단바)에 알려줍니다. */
  onSaved: (avatar: string) => void;
};

/**
 * 상단바 프로필 아이콘을 누르면 뜨는 "프로필 수정" 팝업.
 * /profile 페이지(DefaultProfile)와 같은 "기본 프로필" 데이터를 다루지만,
 * 페이지 이동 없이 현재 화면 위에 모달로 띄우기 위해 별도 컴포넌트로 뺐습니다.
 */
export default function ProfileEditModal({ open, onClose, onSaved }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(DEFAULT_AVATAR_KEY);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 열릴 때마다 최신 프로필을 다시 불러옵니다.
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);

    const fetchProfile = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!mounted || !userData.user) return;
      setUserId(userData.user.id);

      const { data } = await supabase
        .from('profiles')
        .select('nickname, avatar, avatar_url')
        .eq('id', userData.user.id)
        .maybeSingle();

      if (!mounted) return;
      if (data) {
        setNickname(data.nickname ?? '');
        setSelectedAvatar(data.avatar ?? DEFAULT_AVATAR_KEY);
        setAvatarUrl(data.avatar_url ?? null);
      }
      setLoading(false);
    };

    fetchProfile();
    return () => {
      mounted = false;
    };
  }, [open]);

  if (!open) return null;

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
      return;
    }
    // 상단바 아바타를 바로 갱신하고 닫습니다.
    onSaved(avatarUrl || selectedAvatar);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="profile-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="profile-modal-header">
          <h2>프로필 수정</h2>
          <button className="modal-close-button" type="button" aria-label="닫기" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>

        {loading ? (
          <p className="settings-desc">불러오는 중...</p>
        ) : (
          <>
            <div className="profile-photo-section">
              <div className="profile-photo-preview">
                <img src={avatarUrl || getAvatarSrc(selectedAvatar)} alt="프로필 사진" />
              </div>
              <div className="profile-photo-actions">
                <button type="button" className="secondary-button" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? '업로드 중...' : '사진 업로드'}
                </button>
                {avatarUrl && (
                  <button type="button" className="text-danger-button" onClick={() => { setAvatarUrl(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}>
                    사진 제거
                  </button>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileChange} hidden />
            </div>

            <div className="profile-avatar-section">
              <div className="profile-section-label">아바타 선택</div>
              <div className="avatar-grid">
                {AVATAR_OPTIONS.map((a) => (
                  <button
                    key={a.key}
                    type="button"
                    className={`avatar-option${!avatarUrl && selectedAvatar === a.key ? ' is-selected' : ''}`}
                    onClick={() => { setSelectedAvatar(a.key); setAvatarUrl(null); }}
                  >
                    <img src={a.src} alt="" />
                  </button>
                ))}
              </div>
            </div>

            <div className="profile-field">
              <label htmlFor="profileModalNickname">닉네임</label>
              <input
                id="profileModalNickname"
                className="profile-input"
                type="text"
                placeholder="닉네임을 입력하세요"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                maxLength={12}
              />
            </div>

            <div className="profile-modal-actions">
              <button type="button" className="secondary-button" onClick={onClose}>취소</button>
              <button type="button" className="primary-button" onClick={handleSave} disabled={saving || uploading}>
                {saving ? '저장 중...' : '저장하기'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
