import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';

type Member = {
  id: string;
  user_id: string;
  joined_at: string;
  nickname: string;
  avatar: string;
};

export default function MemberList() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState('');
  const [groupName, setGroupName] = useState('');

  useEffect(() => {
    fetchMembers();
  }, [groupId]);

  const fetchMembers = async () => {
    const { data: userData } = await supabase.auth.getUser();
    setCurrentUserId(userData.user?.id || '');

    const { data: groupData } = await supabase
      .from('groups')
      .select('name')
      .eq('id', groupId)
      .single();
    if (groupData) setGroupName(groupData.name);

    // group_members + profiles 직접 join
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
    return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 참여`;
  };

  if (loading) return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#888' }}>불러오는 중...</div>;

  return (
    <div style={{ maxWidth: 600, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 20px' }}>
      <div style={{ marginBottom: 24 }}>
        <button onClick={() => navigate(`/group/${groupId}`)}
          style={{ background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 10 }}>
          ← 그룹으로
        </button>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>👥 멤버</h2>
        <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>{groupName} · {members.length}명</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {members.map((m, i) => {
          const isMe = m.user_id === currentUserId;
          return (
            <div key={m.id} style={{ background: '#fff', border: '0.5px solid #eee', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#5865f2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, flexShrink: 0 }}>
                {m.avatar || '🐱'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{m.nickname || '알 수 없음'}</span>
                  {isMe && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#E1F5EE', color: '#085041' }}>나</span>}
                  {i === 0 && <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: '#E6F1FB', color: '#185FA5' }}>👑 방장</span>}
                </div>
                <div style={{ fontSize: 12, color: '#aaa', marginTop: 3 }}>{formatDate(m.joined_at)}</div>
              </div>
            </div>
          );
        })}
      </div>

      {members.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: '#aaa' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>👥</div>
          <div style={{ fontSize: 14 }}>멤버가 없어요</div>
        </div>
      )}
    </div>
  );
}