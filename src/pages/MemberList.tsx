import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';
import { getAvatarSrc } from '../utils/avatarOptions';
import { getApiBase } from '../utils/apiBase';
import { fetchGroupMeta, isGroupOwner } from '../utils/groupPermissions';

type Member = {
  id: string;
  user_id: string;
  joined_at: string;
  nickname: string;
  avatar: string;
  is_owner?: boolean;
};

/**
 * 팀원 목록 — 방장은 다른 멤버를 내보낼 수 있습니다.
 */
export default function MemberList() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');
  const [owner, setOwner] = useState(false);
  const [kickingId, setKickingId] = useState<string | null>(null);

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

    setMembers((data as Member[]) || []);
    // RPC에 is_owner가 없으면 created_by로 보정
    if (meta?.createdBy && data) {
      const rows = data as Member[];
      if (rows.length && rows.every((r) => r.is_owner === undefined)) {
        setMembers(
          rows.map((r) => ({
            ...r,
            is_owner: r.user_id === meta.createdBy,
          })),
        );
      }
    }
    setLoading(false);
  };

  useEffect(() => {
    void fetchMembers();
  }, [groupId]);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  };

  /** DB에서 멤버 제거 + 회의 중이면 LiveKit 강제 퇴장 시도 */
  const kickMember = async (member: Member) => {
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

    // 회의방에 있으면 서버가 LiveKit에서 제거 (실패해도 DB 강퇴는 유지)
    try {
      await fetch(`${getApiBase()}/api/livekit-remove-participant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: groupId, identity: member.user_id }),
      });
    } catch {
      /* 서버 없거나 방 비어 있어도 OK */
    }

    setKickingId(null);
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
              const isMe = m.user_id === currentUserId;
              const isOwnerRow = Boolean(m.is_owner);
              return (
                <div key={m.id} className="list-row member-row">
                  <div className="person-cell">
                    <div className="avatar-circle">
                      <img src={getAvatarSrc(m.avatar)} alt="" />
                    </div>
                    <div>
                      <div className="person-name">{m.nickname || '알 수 없음'}</div>
                      <div className="person-sub">{isMe ? '나' : ''}</div>
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
                        onClick={() => kickMember(m)}
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
      </div>
    </AppShell>
  );
}
