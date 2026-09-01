import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { addGroupMember, joinGroupByInviteCode } from '../utils/joinGroup';
import AppSidebar from '../components/AppSidebar';
import layout from '../styles/pageLayout.module.css';
import s from './MainPage.module.css';

function rndCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'GRP-';
  for (let i = 0; i < 5; i++) out += c[Math.floor(Math.random() * c.length)];
  return out;
}

type Group = {
  id: string;
  name: string;
  invite_code: string;
};

export default function MainPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [groupName, setGroupName] = useState('');
  const [groups, setGroups] = useState<Group[]>([]);
  const [inviteInput, setInviteInput] = useState(searchParams.get('code')?.toUpperCase() ?? '');
  const [joinMsg, setJoinMsg] = useState('');
  const [joinSuccess, setJoinSuccess] = useState(false);
  const [userId, setUserId] = useState('');

  useEffect(() => {
    const init = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { navigate('/'); return; }
      setUserId(userData.user.id);
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
      const seen = new Set<string>();
      const list: Group[] = [];
      for (const row of data as { groups: Group | Group[] | null }[]) {
        const raw = row.groups;
        const g = Array.isArray(raw) ? raw[0] : raw;
        if (!g?.id || seen.has(g.id)) continue;
        seen.add(g.id);
        list.push(g);
      }
      setGroups(list);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim()) return;
    const code = rndCode();
    const { data, error } = await supabase
      .from('groups')
      .insert({ name: groupName, invite_code: code, created_by: userId })
      .select().maybeSingle();

    if (error || !data) { alert(`생성 실패: ${error?.message}`); return; }

    const memberResult = await addGroupMember(data.id, userId);
    if (!memberResult.ok) {
      alert(`그룹은 만들어졌지만 멤버 등록 실패: ${memberResult.error}`);
      return;
    }
    setGroupName('');
    fetchGroups(userId);
    navigate(`/group/${data.id}`);
  };

  const joinGroup = async () => {
    if (!userId) return;
    const result = await joinGroupByInviteCode(inviteInput, userId);
    if (!result.ok) {
      setJoinMsg(result.error);
      setJoinSuccess(false);
      return;
    }

    setJoinMsg(result.alreadyMember ? `이미 ${result.group.name}에 참여 중이에요` : `${result.group.name}에 참여했어요!`);
    setJoinSuccess(true);
    setInviteInput('');
    fetchGroups(userId);
    setTimeout(() => navigate(`/group/${result.group.id}`), 800);
  };

  return (
    <div className={layout.wrap}>
      <AppSidebar />

      <div className={layout.content}>
        <div className={layout.contentHeader}>
          <div>
            <div className={layout.pageTitle}>내 그룹</div>
            <div className={layout.pageSub}>그룹을 만들거나 초대코드로 참여하세요</div>
          </div>
        </div>

        <div className={s.actionGrid}>
          <div className={s.actionCard}>
            <div className={s.actionCardHead}>
              <div className={`${s.actionIcon} ${s.actionIconGreen}`}>👥</div>
              <div>
                <div className={s.actionTitle}>새 그룹 만들기</div>
                <div className={s.actionDesc}>팀을 생성하고 초대코드 발급</div>
              </div>
            </div>
            <input
              className={s.actionInput}
              placeholder="그룹 이름 입력"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
            />
            <button className={s.btnGreen} onClick={createGroup}>그룹 생성하기</button>
          </div>

          <div className={s.actionCard}>
            <div className={s.actionCardHead}>
              <div className={`${s.actionIcon} ${s.actionIconBlue}`}>🔑</div>
              <div>
                <div className={s.actionTitle}>초대코드로 참여하기</div>
                <div className={s.actionDesc}>코드를 입력해 그룹에 합류</div>
              </div>
            </div>
            <input
              className={`${s.actionInput} ${s.uppercase}`}
              placeholder="초대코드 입력 (예: GRP-AB12C)"
              value={inviteInput}
              onChange={e => setInviteInput(e.target.value)}
            />
            <button className={s.btnBlue} onClick={joinGroup}>그룹 참여하기</button>
            {joinMsg && (
              <div className={`${s.joinMsg} ${joinSuccess ? s.joinMsgSuccess : s.joinMsgError}`}>
                {joinMsg}
              </div>
            )}
          </div>
        </div>

        <div className={layout.sectionLabel}>내 그룹 목록</div>
        <div className={s.roomsGrid}>
          {groups.map((g) => (
            <div key={g.id} className={s.roomCard} onClick={() => navigate(`/group/${g.id}`)}>
              <span className={s.roomIcon}>👥</span>
              <div className={s.roomName}>{g.name}</div>
              <div className={s.roomMeta}>코드: {g.invite_code}</div>
            </div>
          ))}
          <div className={`${s.roomCard} ${s.roomAdd}`} onClick={createGroup}>
            <span className={s.roomIcon}>+</span>
            <span>그룹 추가</span>
          </div>
        </div>
      </div>
    </div>
  );
}
