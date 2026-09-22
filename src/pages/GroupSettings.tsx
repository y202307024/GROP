import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import VoiceSettingsPanel from '../components/VoiceSettingsPanel';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import {
  fetchGroupMeta,
  generateInviteCode,
  isGroupOwner,
  type GroupMeta,
} from '../utils/groupPermissions';

const MAX_FILE_SIZE_MB = 3;

/**
 * 그룹 설정 — 방장은 이름/프사/초대코드/권한 토글, 멤버는 음성·조회·그룹 나가기.
 */
export default function GroupSettings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [userId, setUserId] = useState('');
  const [meta, setMeta] = useState<GroupMeta | null>(null);
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [membersCanRecord, setMembersCanRecord] = useState(true);
  const [membersCanDraw, setMembersCanDraw] = useState(true);
  const [membersCanChangeBoard, setMembersCanChangeBoard] = useState(true);
  const [copied, setCopied] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);

  const owner = isGroupOwner(meta, userId);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      if (!id) return;
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        navigate('/');
        return;
      }
      if (!mounted) return;
      setUserId(userData.user.id);

      const loaded = await fetchGroupMeta(id);
      if (!mounted || !loaded) {
        setLoading(false);
        return;
      }
      setMeta(loaded);
      setName(loaded.name);
      setInviteCode(loaded.inviteCode);
      setAvatarUrl(loaded.avatarUrl);
      setMembersCanRecord(loaded.settings.membersCanRecord);
      setMembersCanDraw(loaded.settings.membersCanDraw);
      setMembersCanChangeBoard(loaded.settings.membersCanChangeBoard);
      setLoading(false);
    };
    void load();
    return () => {
      mounted = false;
    };
  }, [id, navigate]);

  const saveName = async () => {
    if (!owner || !id || !name.trim()) return;
    setSaving(true);
    const { error } = await supabase.from('groups').update({ name: name.trim() }).eq('id', id);
    setSaving(false);
    if (error) alert(`저장 실패: ${error.message}`);
    else {
      setMeta((prev) => (prev ? { ...prev, name: name.trim() } : prev));
      alert('그룹 이름이 변경되었습니다!');
    }
  };

  /** 그룹 프사 업로드 — avatars 버킷의 본인 폴더에 저장 후 groups.avatar_url 갱신 */
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !owner || !userId || !id) return;
    if (!file.type.startsWith('image/')) {
      alert('이미지 파일만 업로드할 수 있어요');
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      alert(`이미지 용량은 ${MAX_FILE_SIZE_MB}MB 이하로 올려주세요`);
      return;
    }

    setUploading(true);
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${userId}/group-avatar-${id}-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (uploadError) {
      alert(`사진 업로드 실패: ${uploadError.message}`);
      setUploading(false);
      return;
    }
    const { data: publicUrlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const url = publicUrlData.publicUrl;
    const { error } = await supabase.from('groups').update({ avatar_url: url }).eq('id', id);
    setUploading(false);
    if (error) {
      alert(`저장 실패: ${error.message}`);
      return;
    }
    setAvatarUrl(url);
    setMeta((prev) => (prev ? { ...prev, avatarUrl: url } : prev));
  };

  const removeAvatar = async () => {
    if (!owner || !id) return;
    const { error } = await supabase.from('groups').update({ avatar_url: null }).eq('id', id);
    if (error) {
      alert(`제거 실패: ${error.message}`);
      return;
    }
    setAvatarUrl(null);
    setMeta((prev) => (prev ? { ...prev, avatarUrl: null } : prev));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const copyCode = () => {
    navigator.clipboard.writeText(inviteCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const regenerateCode = async () => {
    if (!owner || !id) return;
    if (!confirm('초대코드를 새로 발급할까요? 이전 코드는 더 이상 사용할 수 없습니다.')) return;
    const next = generateInviteCode();
    const { error } = await supabase.from('groups').update({ invite_code: next }).eq('id', id);
    if (error) {
      alert(`재발급 실패: ${error.message}`);
      return;
    }
    setInviteCode(next);
    setMeta((prev) => (prev ? { ...prev, inviteCode: next } : prev));
    alert(`새 초대코드: ${next}`);
  };

  const savePermissions = async () => {
    if (!owner || !id) return;
    setSaving(true);
    // upsert로 settings 행이 없어도 생성합니다.
    const { error } = await supabase.from('group_settings').upsert(
      {
        group_id: id,
        members_can_record: membersCanRecord,
        members_can_draw: membersCanDraw,
        members_can_change_board: membersCanChangeBoard,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'group_id' },
    );
    setSaving(false);
    if (error) alert(`권한 저장 실패: ${error.message}`);
    else {
      setMeta((prev) =>
        prev
          ? {
              ...prev,
              settings: { membersCanRecord, membersCanDraw, membersCanChangeBoard },
            }
          : prev,
      );
      alert('권한 설정이 저장되었습니다.');
    }
  };

  /** 일반 멤버가 그룹에서 나갑니다. 방장은 탈퇴 불가(다른 멤버에게 방장 이양 필요). */
  const leaveGroup = async () => {
    if (!id || !userId) return;
    if (owner) {
      alert('방장은 그룹을 나갈 수 없습니다. 그룹을 없애려면 「그룹 제거하기」를 사용해 주세요.');
      return;
    }
    if (!confirm('이 그룹에서 나가시겠습니까? 다시 들어오려면 초대코드가 필요합니다.')) return;

    setLeaving(true);
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', id)
      .eq('user_id', userId);
    setLeaving(false);

    if (error) {
      alert(`나가기 실패: ${error.message}`);
      return;
    }
    alert('그룹에서 나갔습니다.');
    navigate('/main');
  };

  /** 방장이 그룹 전체를 삭제합니다. 멤버·회의·보드 등도 cascade 로 함께 삭제됩니다. */
  const deleteGroup = async () => {
    if (!owner || !id) return;
    const label = name.trim() || '이 그룹';
    if (
      !confirm(
        `"${label}" 그룹을 정말 제거할까요?\n멤버·회의·문서·화이트보드가 모두 삭제되며 되돌릴 수 없습니다.`,
      )
    ) {
      return;
    }
    // 실수 방지용 한 번 더 확인
    if (!confirm('마지막으로 한 번 더 확인합니다. 그룹을 영구 삭제할까요?')) return;

    setDeleting(true);
    const { error } = await supabase.from('groups').delete().eq('id', id);
    setDeleting(false);

    if (error) {
      alert(`그룹 제거 실패: ${error.message}\n(Supabase에서 12_그룹삭제.sql 을 실행했는지 확인해 주세요.)`);
      return;
    }
    alert('그룹이 제거되었습니다.');
    navigate('/main');
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
        <div className="page-header">
          <h1>설정</h1>
        </div>

        <div className="settings-card">
          {/* 그룹 프사 — 방장만 변경 */}
          <div className="settings-section">
            <h3>그룹 프로필 사진</h3>
            <p className="settings-desc">그룹 상세 화면 앞쪽 아이콘에 표시됩니다.</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <div
                className="group-detail-avatar"
                style={{ width: 72, height: 72, fontSize: 28, overflow: 'hidden' }}
              >
                {avatarUrl ? (
                  <img src={avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  (name.trim().charAt(0) || 'G').toUpperCase()
                )}
              </div>
              {owner ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={handleAvatarChange}
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? '업로드 중...' : '사진 변경'}
                  </button>
                  {avatarUrl ? (
                    <button className="danger-button" type="button" onClick={removeAvatar}>
                      사진 제거
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="settings-desc">방장만 변경할 수 있습니다.</p>
              )}
            </div>
          </div>

          <div className="settings-section">
            <h3>그룹 이름</h3>
            <p className="settings-desc">다른 멤버에게 보이는 그룹 이름입니다.</p>
            <div className="settings-row">
              <label htmlFor="groupName">그룹 이름</label>
              <input
                id="groupName"
                className="settings-field"
                value={name}
                disabled={!owner}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {owner ? (
              <button className="primary-button" type="button" disabled={saving} onClick={saveName}>
                저장하기
              </button>
            ) : null}
          </div>

          <div className="settings-section">
            <h3>초대코드</h3>
            <p className="settings-desc">이 코드를 공유하면 그룹에 참여할 수 있습니다.</p>
            <div className="settings-row">
              <label>초대코드</label>
              <input className="settings-field" value={inviteCode} disabled />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="secondary-button" type="button" onClick={copyCode}>
                {copied ? '복사됨' : '복사'}
              </button>
              {owner ? (
                <button className="secondary-button" type="button" onClick={regenerateCode}>
                  재발급
                </button>
              ) : null}
            </div>
          </div>

          {/* 멤버 권한 — 전원 열람, 방장만 수정 */}
          <div className="settings-section">
            <h3>멤버 권한 (그룹 기본)</h3>
            <p className="settings-desc">
              {owner
                ? '방장은 항상 가능합니다. 아래는 일반 멤버 기본 허용입니다. 특정 멤버만 막으려면 팀원 목록에서 클릭하세요.'
                : '열람만 가능합니다. 권한 변경은 방장만 할 수 있습니다.'}
            </p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={membersCanRecord}
                disabled={!owner}
                onChange={(e) => setMembersCanRecord(e.target.checked)}
              />
              회의록 녹화 / 저장 허용
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={membersCanDraw}
                disabled={!owner}
                onChange={(e) => setMembersCanDraw(e.target.checked)}
              />
              화이트보드 판서 허용
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={membersCanChangeBoard}
                disabled={!owner}
                onChange={(e) => setMembersCanChangeBoard(e.target.checked)}
              />
              보드 변경(선택·생성·이름) 허용
            </label>
            {owner ? (
              <button className="primary-button" type="button" disabled={saving} onClick={savePermissions}>
                권한 저장
              </button>
            ) : null}
          </div>

          <div className="settings-section">
            <h3>음성</h3>
            <p className="settings-desc">마이크와 헤드셋을 미리 확인하고 조절합니다.</p>
            <VoiceSettingsPanel hideHeading />
          </div>

          <div className="settings-section">
            <h3>{owner ? '그룹 제거' : '그룹 나가기'}</h3>
            <p className="settings-desc">
              {owner
                ? '그룹을 제거하면 멤버·회의·문서·화이트보드가 모두 삭제되며 되돌릴 수 없습니다.'
                : '나가면 이 그룹의 회의·문서·화이트보드에 접근할 수 없습니다. 다시 참여하려면 초대코드가 필요합니다.'}
            </p>
            {owner ? (
              <button
                className="danger-button"
                type="button"
                disabled={deleting}
                onClick={() => void deleteGroup()}
              >
                {deleting ? '제거 중...' : '그룹 제거하기'}
              </button>
            ) : (
              <button
                className="danger-button"
                type="button"
                disabled={leaving}
                onClick={() => void leaveGroup()}
              >
                {leaving ? '처리 중...' : '그룹 나가기'}
              </button>
            )}
          </div>

          <div className="settings-section">
            <button className="secondary-button" type="button" onClick={() => navigate(`/group/${id}`)}>
              그룹으로 돌아가기
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
