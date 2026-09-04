import { useState, useEffect, useRef } from 'react';
import { supabase } from '../services/supabaseClient'; // GroupPage.tsx와 동일한 경로로 맞춤
import { useNavigate, useParams } from 'react-router-dom';

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
    return <div style={{ padding: '40px', textAlign: 'center' }}>불러오는 중...</div>;
  }

  return (
    <div style={{ maxWidth: '400px', margin: '60px auto', fontFamily: 'sans-serif', textAlign: 'center' }}>
      <h2>프로필 수정</h2>
      <p style={{ color: '#888', marginTop: '-8px', marginBottom: '24px', fontSize: '14px' }}>
        이 그룹에서만 사용되는 프로필이에요
      </p>

      {/* 미리보기: 업로드 사진이 있으면 사진, 없으면 이모지 */}
      <div style={{ marginBottom: '16px' }}>
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt="프로필 사진"
            style={{
              width: '96px',
              height: '96px',
              borderRadius: '50%',
              objectFit: 'cover',
              marginBottom: '8px',
              border: '2px solid #3498db',
            }}
          />
        ) : (
          <div style={{ fontSize: '60px', marginBottom: '8px' }}>{selectedAvatar}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
          {/* 실제 input은 숨기고 버튼 클릭 시 코드로 열어줌 */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              fontSize: '13px',
              padding: '6px 12px',
              borderRadius: '6px',
              border: '1px solid #3498db',
              background: 'white',
              color: '#3498db',
              cursor: 'pointer',
            }}
          >
            {uploading ? '업로드 중...' : '📷 사진 업로드'}
          </button>
          {avatarUrl && (
            <button
              type="button"
              onClick={handleRemovePhoto}
              style={{
                fontSize: '13px',
                padding: '6px 12px',
                borderRadius: '6px',
                border: '1px solid #ddd',
                background: 'white',
                color: '#777',
                cursor: 'pointer',
              }}
            >
              사진 제거
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
      </div>

      {/* 이모지 아바타 선택 (사진 없을 때 사용됨) */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ fontSize: '12px', color: '#999', marginBottom: '8px' }}>
          또는 이모지 아바타 선택
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {avatars.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => {
                setSelectedAvatar(a);
                setAvatarUrl(null); // 이모지 선택 시 업로드 사진은 해제
              }}
              style={{
                fontSize: '24px',
                padding: '6px',
                border: !avatarUrl && selectedAvatar === a ? '2px solid #3498db' : '2px solid transparent',
                borderRadius: '8px',
                background: !avatarUrl && selectedAvatar === a ? '#eaf4fd' : 'transparent',
                cursor: 'pointer',
              }}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      {/* 닉네임 입력 */}
      <div style={{ marginBottom: '16px' }}>
        <input
          type="text"
          placeholder="닉네임 입력"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          maxLength={12}
          style={{
            width: '100%',
            padding: '10px',
            boxSizing: 'border-box',
            fontSize: '16px',
            borderRadius: '6px',
            border: '1px solid #ddd',
          }}
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving || uploading}
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: '#3498db',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          borderRadius: '6px',
          fontSize: '16px',
          marginBottom: '8px',
        }}
      >
        {saving ? '저장 중...' : '저장하기'}
      </button>

      <button
        onClick={() => navigate(`/group/${groupId}`)}
        style={{
          width: '100%',
          padding: '12px',
          backgroundColor: '#7f8c8d',
          color: 'white',
          border: 'none',
          cursor: 'pointer',
          borderRadius: '6px',
          fontSize: '16px',
        }}
      >
        ⬅️ 그룹으로
      </button>
    </div>
  );
}