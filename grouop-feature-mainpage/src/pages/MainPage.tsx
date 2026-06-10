import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import './MainPage.css';

function rndCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = 'GRP-';
  for (let i = 0; i < 5; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

const menuItems = [
  { icon: '🏠', label: '홈', active: true },
  { icon: '👥', label: '내 그룹', active: false },
  { icon: '📹', label: '회의', active: false },
  { icon: '📄', label: '문서', active: false },
  { icon: '✏️', label: '캔버스', active: false },
];

type Group = {
  id: string;
  name: string;
  invite_code: string;
};

export default function MainPage() {
  const navigate = useNavigate();
  const [groupName, setGroupName] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [inviteInput, setInviteInput] = useState('');
  const [joinMsg, setJoinMsg] = useState('');
  const [joinSuccess, setJoinSuccess] = useState(false);
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('🐱');
  const [userId, setUserId] = useState('');

  useEffect(() => {
    const init = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { navigate('/'); return; }
      setUserId(userData.user.id);

      const { data: profile } = await supabase
        .from('profiles').select('nickname, avatar')
        .eq('id', userData.user.id).single();
      if (profile) { setNickname(profile.nickname ?? ''); setAvatar(profile.avatar ?? '🐱'); }

      fetchGroups(userData.user.id);
    };
    init();
  }, []);

  const fetchGroups = async (uid: string) => {
    const { data } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name, invite_code)')
      .eq('user_id', uid);
    if (data) {
      const list = data.map((d: any) => d.groups).filter(Boolean);
      setGroups(list);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim()) return;
    const code = rndCode();
    const { data, error } = await supabase
      .from('groups')
      .insert({ name: groupName, invite_code: code, created_by: userId })
      .select().single();

    if (error) { alert(`생성 실패: ${error.message}`); return; }

    await supabase.from('group_members').insert({ group_id: data.id, user_id: userId });
    setGroupName('');
    fetchGroups(userId);
    navigate(`/group/${data.id}`);
  };

  const joinGroup = async () => {
    const v = inviteInput.trim().toUpperCase();
    if (!v) { setJoinMsg('코드를 입력해주세요'); setJoinSuccess(false); return; }

    const { data: group, error } = await supabase
      .from('groups').select('id, name').eq('invite_code', v).single();

    if (error || !group) { setJoinMsg('그룹을 찾을 수 없어요'); setJoinSuccess(false); return; }

    const { error: joinError } = await supabase
      .from('group_members').insert({ group_id: group.id, user_id: userId });

    if (joinError) { setJoinMsg('이미 참여한 그룹이에요'); setJoinSuccess(false); return; }

    setJoinMsg(`${group.name}에 참여했어요!`);
    setJoinSuccess(true);
    setInviteInput('');
    fetchGroups(userId);
    setTimeout(() => navigate(`/group/${group.id}`), 800);
  };

  return (
    <div className="main-wrap">
      <div className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">G</div>
          <span className="sidebar-logo-text">Groupop</span>
        </div>
        <div className="sidebar-menu">
          {menuItems.map((item, i) => (
            <button key={i} className={`menu-item ${item.active ? 'active' : ''}`}>
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-profile" onClick={() => navigate('/profile')} style={{ cursor: 'pointer' }}>
          <div className="profile-avatar">
            <div className="avatar-circle">{avatar}</div>
            <div className="online-dot" />
          </div>
          <div className="profile-info">
            <div className="profile-name">{nickname || '...'}</div>
            <div className="profile-status">온라인</div>
          </div>
          <button className="logout-btn" onClick={(e) => { e.stopPropagation(); navigate('/'); }} title="로그아웃">🚪</button>
        </div>
      </div>

      <div className="content">
        <div className="content-header">
          <div>
            <div className="page-title">내 그룹</div>
            <div className="page-sub">그룹을 만들거나 초대코드로 참여하세요</div>
          </div>
        </div>

        <div className="action-grid">
          <div className="action-card">
            <div className="action-card-head">
              <div className="action-icon green">👥</div>
              <div>
                <div className="action-title">새 그룹 만들기</div>
                <div className="action-desc">팀을 생성하고 초대코드 발급</div>
              </div>
            </div>
            <input className="action-input" placeholder="그룹 이름 입력" value={groupName} onChange={e => setGroupName(e.target.value)} />
            <button className="btn-green" onClick={createGroup}>그룹 생성하기</button>
          </div>

          <div className="action-card">
            <div className="action-card-head">
              <div className="action-icon blue">🔑</div>
              <div>
                <div className="action-title">초대코드로 참여하기</div>
                <div className="action-desc">코드를 입력해 그룹에 합류</div>
              </div>
            </div>
            <input className="action-input uppercase" placeholder="초대코드 입력 (예: GRP-AB12C)" value={inviteInput} onChange={e => setInviteInput(e.target.value)} />
            <button className="btn-blue" onClick={joinGroup}>그룹 참여하기</button>
            {joinMsg && <div className={`join-msg ${joinSuccess ? 'success' : 'error'}`}>{joinMsg}</div>}
          </div>
        </div>

        <div className="section-label">내 그룹 목록</div>
        <div className="rooms-grid">
          {groups.map((g) => (
            <div key={g.id} className="room-card" onClick={() => navigate(`/group/${g.id}`)} style={{ cursor: 'pointer' }}>
              <span className="room-icon">👥</span>
              <div className="room-name">{g.name}</div>
              <div className="room-meta">코드: {g.invite_code}</div>
            </div>
          ))}
          <div className="room-card room-add" onClick={createGroup} style={{ cursor: 'pointer' }}>
            <span className="room-icon">+</span>
            <span style={{ fontSize: 12 }}>그룹 추가</span>
          </div>
        </div>
      </div>
    </div>
  );
}