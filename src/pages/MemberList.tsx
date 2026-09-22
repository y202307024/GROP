import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { getAvatarSrc } from '../utils/avatarOptions';
import { getApiBase } from '../utils/apiBase';
import {
  canChangeBoard,
  canDraw,
  canRecord,
  fetchGroupMeta,
  fetchMemberPermissions,
  isGroupOwner,
  saveMemberPermissions,
  type GroupMeta,
  type MemberPermissionFlags,
} from '../utils/groupPermissions';

type Member = {
  id: string;
  user_id: string;
  joined_at: string;
  nickname: string;
  avatar: string;
  is_owner?: boolean;
};

/**
 * 팀원 목록 — 방장은 멤버를 클릭해 개별 권한을 토글하고, 내보낼 수 있습니다.
 * 멤버는 본인·다른 멤버 권한을 열람만 할 수 있습니다.
 */
export default function MemberList() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');
  const [owner, setOwner] = useState(false);
  const [groupMeta, setGroupMeta] = useState<GroupMeta | null>(null);
  const [kickingId, setKickingId] = useState<string | null>(null);

  // 멤버 클릭 → 개별 권한 패널
  const [selected, setSelected] = useState<Member | null>(null);
  const [permFlags, setPermFlags] = useState<MemberPermissionFlags>({
    canRecord: true,
    canDraw: true,
    canChangeBoard: true,
  });
  const [permLoading, setPermLoading] = useState(false);
  const [permSaving, setPermSaving] = useState(false);

  const fetchMembers = async () => {
    if (!groupId) return;
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id || '';
    setCurrentUserId(uid);

    const meta = await fetchGroupMeta(groupId);
    setGroupMeta(meta);
    setOwner(isGroupOwner(meta, uid));

    const { data, error } = await supabase.rpc('get_group_members_with_profiles', {
      p_group_id: groupId,
    });

    if (error) {
      console.error('멤버 조회 실패:', error);
      setLoading(false);
      return;
    }

    let rows = (data as Member[]) || [];
    if (meta?.createdBy && rows.length && rows.every((r) => r.is_owner === undefined)) {
      rows = rows.map((r) => ({
        ...r,
        is_owner: r.user_id === meta.createdBy,
      }));
    }
    setMembers(rows);
    setLoading(false);
  };

  useEffect(() => {
    void fetchMembers();
  }, [groupId]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  /**
   * 멤버 권한 패널 열기.
   * - editing=true: 방장이 다른 멤버의 개별 토글을 수정
   * - editing=false: 본인 포함 전원 열람 (실제 적용 권한 표시)
   * 멤버도 본인 행을 클릭하면 여기로 들어옵니다.
   */
  const openMemberPerms = async (member: Member, editing = false) => {
    if (!groupId) return;

    setSelected(member);
    setPermLoading(true);

    // 방장 계정 행: 항상 전부 허용으로 표시
    if (member.is_owner) {
      setPermFlags({ canRecord: true, canDraw: true, canChangeBoard: true });
      setPermLoading(false);
      return;
    }

    const flags = await fetchMemberPermissions(groupId, member.user_id);
    if (editing) {
      setPermFlags(flags);
    } else {
      const meta = groupMeta ?? (await fetchGroupMeta(groupId));
      if (meta && !groupMeta) setGroupMeta(meta);
      setPermFlags({
        canRecord: canRecord(meta, member.user_id, flags),
        canDraw: canDraw(meta, member.user_id, flags),
        canChangeBoard: canChangeBoard(meta, member.user_id, flags),
      });
    }
    setPermLoading(false);
  };

  const closePermPanel = () => {
    setSelected(null);
  };

  /** 방장이 다른 멤버 권한을 편집 중인지 */
  const canEditSelected =
    owner && selected && !selected.is_owner && selected.user_id !== currentUserId;

  const savePerms = async () => {
    if (!canEditSelected || !groupId || !selected) return;
    setPermSaving(true);
    const result = await saveMemberPermissions(groupId, selected.user_id, permFlags);
    setPermSaving(false);
    if (!result.ok) {
      alert(`권한 저장 실패: ${result.error}`);
      return;
    }
    alert('멤버 권한이 저장되었습니다.');
    closePermPanel();
  };

  /** DB에서 멤버 제거 + 회의 중이면 LiveKit 강제 퇴장 시도 */
  const kickMember = async (member: Member, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!owner || !groupId || member.user_id === currentUserId) return;
    if (member.is_owner) {
      alert('방장은 내보낼 수 없습니다.');
      return;
    }
    const label = member.nickname || '이 멤버';
    if (!confirm(`${label} 님을 그룹에서 내보낼까요?`)) return;

    setKickingId(member.user_id);
    const { error } = await supabase
      .from('group_members')
      .delete()
      .eq('group_id', groupId)
      .eq('user_id', member.user_id);

    if (error) {
      alert(`내보내기 실패: ${error.message}`);
      setKickingId(null);
      return;
    }

    try {
      await fetch(`${getApiBase()}/api/livekit-remove-participant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: groupId, identity: member.user_id }),
      });
    } catch {
      /* ignore */
    }

    setKickingId(null);
    if (selected?.user_id === member.user_id) closePermPanel();
    await fetchMembers();
  };

  return (
    <AppShell activePage="member">
      <div className="page">
        <div className="page-header">
          <h1>팀원</h1>
          <button className="primary-button" type="button" onClick={() => navigate(`/group/${groupId}`)}>
            <Icon name="user-plus" />
            그룹으로
          </button>
        </div>

        {loading ? (
          <div>불러오는 중...</div>
        ) : (
          <div className="list-card">
            <div className="list-row list-head member-row">
              <span>이름</span>
              <span>역할</span>
              <span>가입일</span>
              <span></span>
            </div>
            {members.map((m) => {
              const isMe = Boolean(currentUserId) && m.user_id === currentUserId;
              const isOwnerRow = Boolean(m.is_owner);
              // 방장이 다른 일반 멤버를 편집할 때만 수정 모드, 그 외(본인 포함)는 열람
              const openAsEdit = owner && !isMe && !isOwnerRow;
              return (
                <div
                  key={m.id || m.user_id}
                  className="list-row member-row"
                  role="button"
                  tabIndex={0}
                  aria-label={`${m.nickname || '멤버'} 권한`}
                  onClick={() => {
                    // 본인 클릭 → 항상 열람 모드로 권한 확인
                    void openMemberPerms(m, openAsEdit);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void openMemberPerms(m, openAsEdit);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div className="person-cell">
                    <div className="avatar-circle">
                      <img src={getAvatarSrc(m.avatar)} alt="" />
                    </div>
                    <div>
                      <div className="person-name">{m.nickname || '알 수 없음'}</div>
                      {isMe ? <div className="person-sub">나</div> : null}
                    </div>
                  </div>
                  <span>
                    <span className={`badge${isOwnerRow ? '' : ' badge-muted'}`}>
                      {isOwnerRow ? '방장' : '멤버'}
                    </span>
                  </span>
                  <span>{formatDate(m.joined_at)}</span>
                  <span>
                    {owner && !isMe && !isOwnerRow ? (
                      <button
                        className="danger-button"
                        type="button"
                        disabled={kickingId === m.user_id}
                        onClick={(e) => kickMember(m, e)}
                      >
                        {kickingId === m.user_id ? '처리 중...' : '내보내기'}
                      </button>
                    ) : null}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* 멤버별 권한 패널 — 전원 열람, 방장만 수정 */}
        {selected ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.35)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 200,
            }}
            onClick={closePermPanel}
          >
            <div
              className="settings-card"
              style={{ width: 'min(400px, 92vw)', margin: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="settings-section">
                <h3>{selected.nickname || '멤버'} · 권한</h3>
                <p className="settings-desc">
                  {selected.is_owner
                    ? '방장은 항상 모든 권한이 허용됩니다.'
                    : canEditSelected
                      ? '그룹 설정에서 막혀 있으면 여기서 켜도 적용되지 않습니다. 둘 다 켜져 있어야 가능합니다.'
                      : '열람만 가능합니다. 권한 변경은 방장만 할 수 있습니다.'}
                </p>
                {permLoading ? (
                  <div>불러오는 중...</div>
                ) : (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <input
                        type="checkbox"
                        checked={permFlags.canRecord}
                        disabled={!canEditSelected}
                        onChange={(e) =>
                          setPermFlags((prev) => ({ ...prev, canRecord: e.target.checked }))
                        }
                      />
                      회의록 녹화 / 저장
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <input
                        type="checkbox"
                        checked={permFlags.canDraw}
                        disabled={!canEditSelected}
                        onChange={(e) =>
                          setPermFlags((prev) => ({ ...prev, canDraw: e.target.checked }))
                        }
                      />
                      화이트보드 판서
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                      <input
                        type="checkbox"
                        checked={permFlags.canChangeBoard}
                        disabled={!canEditSelected}
                        onChange={(e) =>
                          setPermFlags((prev) => ({ ...prev, canChangeBoard: e.target.checked }))
                        }
                      />
                      보드 변경 (선택·생성·이름)
                    </label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {canEditSelected ? (
                        <>
                          <button
                            className="primary-button"
                            type="button"
                            disabled={permSaving}
                            onClick={() => void savePerms()}
                          >
                            {permSaving ? '저장 중...' : '저장'}
                          </button>
                          <button
                            className="danger-button"
                            type="button"
                            disabled={kickingId === selected.user_id}
                            onClick={() => void kickMember(selected)}
                          >
                            내보내기
                          </button>
                        </>
                      ) : null}
                      <button className="secondary-button" type="button" onClick={closePermPanel}>
                        닫기
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
