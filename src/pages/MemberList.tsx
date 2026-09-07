import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import AppShell from '../components/AppShell';
import Icon from '../components/Icon';

type Member = {
  id: string;
  user_id: string;
  joined_at: string;
  nickname: string;
  avatar: string;
};

/** 팀원 목록 — grop/css/member.css 클래스명을 그대로 사용합니다. */
export default function MemberList() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');

  useEffect(() => {
    fetchMembers();
  }, [groupId]);

  const fetchMembers = async () => {
    const { data: userData } = await supabase.auth.getUser();
    setCurrentUserId(userData.user?.id || '');

    const { data, error } = await supabase.rpc('get_group_members_with_profiles', {
      p_group_id: groupId
    });

    if (error) {
      console.error('멤버 조회 실패:', error);
      setLoading(false);
      return;
    }

    setMembers(data || []);
    setLoading(false);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
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
            {members.map((m, i) => {
              const isMe = m.user_id === currentUserId;
              return (
                <div key={m.id} className="list-row member-row">
                  <div className="person-cell">
                    <div className="avatar-circle">{m.avatar || '🙂'}</div>
                    <div>
                      <div className="person-name">{m.nickname || '알 수 없음'}</div>
                      <div className="person-sub">{isMe ? '나' : ''}</div>
                    </div>
                  </div>
                  <span>
                    <span className={`badge${i === 0 ? '' : ' badge-muted'}`}>{i === 0 ? '관리자' : '멤버'}</span>
                  </span>
                  <span>{formatDate(m.joined_at)}</span>
                  <span />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
