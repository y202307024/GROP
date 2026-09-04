import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';

type Group = { id: string; name: string; invite_code: string; };

export default function GroupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);

  useEffect(() => {
    supabase.from('groups').select('*').eq('id', id).single()
      .then(({ data }) => { if (data) setGroup(data); });
  }, [id]);

  if (!group) return <div style={{ padding: 40 }}>불러오는 중...</div>;

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0 }}>{group.name}</h2>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>초대코드: {group.invite_code}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/main')}
            style={{ padding: '8px 16px', background: '#eee', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            ⬅️ 메인
          </button>
          <button onClick={() => navigate(`/group/${id}/settings`)}
            style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            ⚙️ 설정
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div onClick={() => navigate(`/room/${id}`)}
          style={{ padding: 24, background: '#eaf4fd', borderRadius: 12, cursor: 'pointer', textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>📹</div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>회의방 입장</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>화상/음성 회의 시작</div>
        </div>

        <div style={{ padding: 24, background: '#f0fdf4', borderRadius: 12, cursor: 'pointer', textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>📅</div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>회의 일정</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>일정 추가 및 관리</div>
        </div>

        <div style={{ padding: 24, background: '#fdf4ff', borderRadius: 12, cursor: 'pointer', textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>📄</div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>회의록</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>지난 회의록 보기</div>
        </div>

        <div style={{ padding: 24, background: '#fffbea', borderRadius: 12, cursor: 'pointer', textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>👥</div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>멤버</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>그룹 멤버 보기</div>
        </div>
      </div>
    </div>
  );
}