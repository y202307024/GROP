import { useEffect, useRef, useState } from 'react';
import { createScaledPortal } from './AppScaleLayer';
import { supabase } from '../services/supabaseClient';
import Icon from './Icon';
import { AVATAR_OPTIONS, DEFAULT_AVATAR_KEY, getAvatarSrc } from '../utils/avatarOptions';

const MAX_FILE_SIZE_MB = 3;

type Props = {
  open: boolean;
  /** 이 그룹에서만 쓰는 프로필을 편집합니다 — group_profiles의 (group_id, user_id) 한 줄 */
  groupId: string;
  onClose: () => void;
  /** 저장 성공 시 호출 — 호출한 쪽(그룹 편집 모달/그룹 페이지)이 멤버 목록을 다시 불러올 수 있게 알려줍니다. */
  onSaved: () => void;
};

/**
 * "그룹 프로필 편집" 팝업 — 상단바의 "프로필 수정"(ProfileEditModal)과 UI를 똑같이 쓰고,
 * 제목과 저장 대상만 다릅니다: profiles(기본 프로필) 대신 group_profiles(이 그룹 전용 프로필).
 * 저장 방식은 /group/:groupId/profile 페이지(GroupProfile)와 같습니다.
 */
export default function GroupProfileEditModal({ open, groupId, onClose, onSaved }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [selectedAvatar, setSelectedAvatar] = useState(DEFAULT_AVATAR_KEY);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 열릴 때마다 최신 값을 다시 불러옵니다.
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setLoading(true);

    const fetchProfile = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!mounted || !userData.user) return;
      setUserId(userData.user.id);

      // 이 그룹 전용 프로필이 있으면 그 값, 아직 없으면 기본 프로필 값으로 채워서 시작합니다.
      const { data: groupProfile } = await supabase
        .from('group_profiles')
        .select('nickname, avatar, avatar_url')
        .eq('group_id', groupId)
        .eq('user_id', userData.user.id)
        .maybeSingle();

      const source =
        groupProfile ??
        (
          await supabase
            .from('profiles')
            .select('nickname, avatar, avatar_url')
            .eq('id', userData.user.id)
            .maybeSingle()
        ).data;

      if (!mounted) return;
      if (source) {
        setNickname(source.nickname ?? '');
        setSelectedAvatar(source.avatar ?? DEFAULT_AVATAR_KEY);
        setAvatarUrl(source.avatar_url ?? null);
      }
      setLoading(false);
    };

    void fetchProfile();
    return () => {
      mounted = false;
    };
  }, [open, groupId]);

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
    // 저장 경로: {userId}/{groupId}-{시간값}.{확장자} — GroupProfile 페이지와 같은 규칙(본인 폴더 RLS)
    const ext = file.name.split('.').pop();
    const path = `${userId}/${groupId}-${Date.now()}.${ext}`;

    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
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
    // (group_id, user_id) 기준 upsert → 그룹마다 다른 프로필을 유지합니다
    const { error } = await supabase.from('group_profiles').upsert(
      { group_id: groupId, user_id: userId, nickname, avatar: selectedAvatar, avatar_url: avatarUrl },
      { onConflict: 'group_id,user_id' },
    );
    setSaving(false);

    if (error) {
      alert(`저장 실패: ${error.message}`);
      return;
    }
    onSaved();
    onClose();
  };

  // createPortal로 body에 직접 그립니다 — AppShell의 .app이 transform: scale()을 가져서 그 안의
  // position: fixed 배경(.modal-overlay)이 화면이 아니라 .app 기준이 되어 화면을 다 못 덮었습니다.
  // (그룹 편집 모달 위에 겹쳐 뜨도록 그 모달보다 나중에 body에 붙습니다)
  return createScaledPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="profile-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="profile-modal-header">
          <h2>그룹 프로필 편집</h2>
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
              <label htmlFor="groupProfileModalNickname">닉네임</label>
              <input
                id="groupProfileModalNickname"
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
    </div>,
  );
}
