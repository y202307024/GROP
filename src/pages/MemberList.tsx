import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { getAvatarSrc } from '../utils/avatarOptions';
import { getApiBase } from '../utils/apiBase';
import {
  fetchGroupMeta,
  fetchMemberPermissions,
  isGroupOwner,
  saveMemberPermissions,
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
 */
export default function MemberList() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');
  const [owner, setOwner] = useState(false);
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

  /** 멤버 행 클릭 — 방장만 권한 패널 오픈 (본인·방장 행 제외) */
  const openMemberPerms = async (member: Member) => {
    if (!owner || !groupId) return;
    if (member.user_id === currentUserId || member.is_owner) return;

    setSelected(member);
    setPermLoading(true);
    const flags = await fetchMemberPermissions(groupId, member.user_id);
    setPermFlags(flags);
    setPermLoading(false);
  };

  const closePermPanel = () => {
    setSelected(null);
  };

  const savePerms = async () => {
    if (!owner || !groupId || !selected) return;
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

        {owner ? (
          <p style={{ color: '#6b7280', fontSize: 14, marginBottom: 12 }}>
            멤버를 클릭하면 그 사람만 녹화·판서 권한을 켜고 끌 수 있습니다. (그룹 기본 권한과 함께 적용)
          </p>
        ) : null}

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
              const isMe = m.user_id === currentUserId;
              const isOwnerRow = Boolean(m.is_owner);
              const clickable = owner && !isMe && !isOwnerRow;
              return (
                <div
                  key={m.id}
                  className="list-row member-row"
                  role={clickable ? 'button' : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  onClick={() => {
                    if (clickable) void openMemberPerms(m);
                  }}
                  onKeyDown={(e) => {
                    if (clickable && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      void openMemberPerms(m);
                    }
                  }}
                  style={clickable ? { cursor: 'pointer' } : undefined}
                >
                  <div className="person-cell">
                    <div className="avatar-circle">
                      <img src={getAvatarSrc(m.avatar)} alt="" />
                    </div>
                    <div>
                      <div className="person-name">{m.nickname || '알 수 없음'}</div>
                      <div className="person-sub">{isMe ? '나' : clickable ? '클릭하여 권한' : ''}</div>
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

        {/* 멤버별 권한 토글 패널 */}
        {selected ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.35)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 50,
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
                  그룹 설정에서 막혀 있으면 여기서 켜도 적용되지 않습니다. 둘 다 켜져 있어야 가능합니다.
                </p>
                {permLoading ? (
                  <div>불러오는 중...</div>
                ) : (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <input
                        type="checkbox"
                        checked={permFlags.canRecord}
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
                        onChange={(e) =>
                          setPermFlags((prev) => ({ ...prev, canChangeBoard: e.target.checked }))
                        }
                      />
                      보드 변경 (선택·생성·이름)
                    </label>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        className="primary-button"
                        type="button"
                        disabled={permSaving}
                        onClick={() => void savePerms()}
                      >
                        {permSaving ? '저장 중...' : '저장'}
                      </button>
                      <button className="secondary-button" type="button" onClick={closePermPanel}>
                        닫기
                      </button>
                      <button
                        className="danger-button"
                        type="button"
                        disabled={kickingId === selected.user_id}
                        onClick={() => void kickMember(selected)}
                      >
                        내보내기
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
