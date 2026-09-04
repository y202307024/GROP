import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';

type Group = { id: string; name: string; invite_code: string; };
type MyProfile = { nickname: string | null; avatar: string | null; avatar_url: string | null };

export default function GroupPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [group, setGroup] = useState<Group | null>(null);
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null); // 이 그룹에서의 내 프로필
  const [copied, setCopied] = useState(false);

  // 초대코드 클립보드 복사
  const copyInviteCode = async () => {
    if (!group) return;
    const code = group.invite_code.trim().toUpperCase();
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt('초대코드를 복사하세요:', code);
    }
  };

  // 그룹 정보 불러오기
  useEffect(() => {
    supabase.from('groups').select('*').eq('id', id).single()
      .then(({ data }) => { if (data) setGroup(data); });
  }, [id]);

  // 이 그룹에서의 내 프로필 불러오기 (없으면 기본 프로필로 fallback)
  useEffect(() => {
    const fetchMyProfile = async () => {
      if (!id) return;
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data: groupProfile } = await supabase
        .from('group_profiles')
        .select('nickname, avatar, avatar_url')
        .eq('group_id', id)
        .eq('user_id', userData.user.id)
        .maybeSingle();

      if (groupProfile) {
        setMyProfile(groupProfile);
        return;
      }

      // 그룹별 설정이 없으면 기본(전역) 프로필 사용
      const { data: defaultProfile } = await supabase
        .from('profiles')
        .select('nickname, avatar, avatar_url')
        .eq('id', userData.user.id)
        .maybeSingle();

      setMyProfile(defaultProfile ?? { nickname: null, avatar: '🐱', avatar_url: null });
    };
    fetchMyProfile();
  }, [id]);

  if (!group) return <div style={{ padding: 40 }}>불러오는 중...</div>;

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'sans-serif', padding: '0 20px' }}>

      {/* 1줄: 내 프로필(동그란 아바타) + 그룹명/초대코드 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => navigate(`/group/${id}/profile`)}
          title="프로필 수정"
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            border: '2px solid #3b3b4d',
            background: '#2a2a3d',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 28,
            padding: 0,
            cursor: 'pointer',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {myProfile?.avatar_url ? (
            <img
              src={myProfile.avatar_url}
              alt="내 프로필"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            myProfile?.avatar ?? '🐱'
          )}
        </button>

        <div>
          <h2 style={{ margin: 0 }}>{group.name}</h2>
          <div style={{ fontSize: 12, color: '#aaa', marginTop: 4 }}>초대코드: {group.invite_code}</div>
        </div>
      </div>

      {/* 2줄: 초대코드 복사(왼쪽) / 메인·프로필·설정(오른쪽) */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <button
          type="button"
          onClick={copyInviteCode}
          style={{
            padding: '6px 12px',
            fontSize: 12,
            border: '1px solid #c7d2fe',
            borderRadius: 8,
            background: '#eef2ff',
            color: '#4f46e5',
            cursor: 'pointer',
          }}
        >
          {copied ? '✓ 초대코드 복사됨' : '🔗 초대코드 복사'}
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => navigate('/main')}
            style={{ padding: '8px 16px', background: '#eee', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            ⬅️ 메인
          </button>

          <button onClick={() => navigate(`/group/${id}/profile`)}
            style={{ padding: '8px 16px', background: '#e0f2fe', border: 'none', borderRadius: 8, cursor: 'pointer', color: '#0369a1' }}>
            👤 프로필
          </button>

          <button onClick={() => navigate(`/group/${id}/settings`)}
            style={{ padding: '8px 16px', background: '#f0f0f0', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            ⚙️ 설정
          </button>
        </div>
      </div>

      {/* 그룹 메뉴 카드 4개 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div onClick={() => navigate(`/room/${id}`)}
          style={{ padding: 24, background: '#eaf4fd', borderRadius: 12, cursor: 'pointer', textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>📹</div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>회의방 입장</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>음성 회의 + 실시간 캔버스</div>
        </div>

        <div style={{ padding: 24, background: '#f0fdf4', borderRadius: 12, cursor: 'pointer', textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>📅</div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>회의 일정</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>일정 추가 및 관리</div>
        </div>

        <div onClick={() => navigate(`/group/${id}/meetings`)}
          style={{ padding: 24, background: '#fdf4ff', borderRadius: 12, cursor: 'pointer', textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>📄</div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>회의록</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>지난 회의록 보기</div>
        </div>

        <div onClick={() => navigate(`/group/${id}/members`)}
          style={{ padding: 24, background: '#fffbea', borderRadius: 12, cursor: 'pointer', textAlign: 'center' }}>
          <div style={{ fontSize: 32 }}>👥</div>
          <div style={{ fontWeight: 600, marginTop: 8 }}>멤버</div>
          <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>그룹 멤버 보기</div>
        </div>
      </div>
    </div>
  );
}