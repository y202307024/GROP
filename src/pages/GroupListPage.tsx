import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import { addGroupMember, joinGroupByInviteCode } from '../utils/joinGroup';
import AppShell from '../components/AppShell';
import GroupModal from '../components/GroupModal';
import Icon from '../components/Icon';
import { useGroupMemberAvatars } from '../hooks/useGroupMemberAvatars';
import { getAvatarSrc } from '../utils/avatarOptions';
import moreVerticalIcon from '../assets/action-icons/more-vertical.svg';
import styles from './GroupListPage.module.css';

// 그룹 상세(GroupPage)·멤버(MemberList)은 어디서 들어왔는지에 따라 사이드바 선택이 달라야 합니다
// (메인에서 왔으면 "메인", 이 그룹 목록에서 왔으면 "그룹"). 이동할 때 라우터 state로 출처를 넘겨서, 상세 화면이 그대로
// 그 사이드바 항목을 유지하게 합니다(state가 없으면 예전처럼 "메인").
const GROUP_FROM_LIST = { from: 'member' } as const;

type Group = { id: string; name: string; invite_code: string };

/** 카드에 표시할 "회의 N / 문서 N / 멤버 N" + 정렬용 마지막 회의 시각 */
type GroupStats = {
  meetingCount: number;
  docCount: number;
  memberCount: number;
  lastActivity: number; // 마지막 회의 시각(ms). 회의가 없으면 0
};

type SortKey = 'recent' | 'name';
const SORT_LABELS: Record<SortKey, string> = { recent: '최근 활동순', name: '이름순' };

/** 즐겨찾기는 아직 DB 컬럼이 없어서 이 브라우저(localStorage)에만 저장합니다. */
const FAVORITES_KEY = 'grop.favoriteGroups';

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/** MainPage와 같은 규칙의 초대코드 생성 (GRP-XXXXX) */
function rndCode() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'GRP-';
  for (let i = 0; i < 5; i++) out += c[Math.floor(Math.random() * c.length)];
  return out;
}

/**
 * 그룹 목록 — 사이드바 "그룹" 탭의 페이지(피그마 "그룹" 화면).
 * 내가 속한 모든 그룹을 2열 카드로 보여주고, 카드 목록 영역만 따로 스크롤됩니다.
 * 그룹 만들기/참가는 MainPage와 같은 GroupModal을 씁니다.
 */
export default function GroupListPage() {
  const navigate = useNavigate();
  const [groups, setGroups] = useState<Group[]>([]);
  const [stats, setStats] = useState<Record<string, GroupStats>>({});
  // 그룹 카드 "참석자" 자리에 그릴 실제 그룹원 프로필 이미지(그룹별)
  const memberAvatars = useGroupMemberAvatars(groups.map((g) => g.id));
  const [userId, setUserId] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('recent');
  const [sortOpen, setSortOpen] = useState(false);
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);

  // 그룹 만들기/참가 모달 상태 (MainPage와 동일)
  const [modalOpen, setModalOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [inviteInput, setInviteInput] = useState('');
  const [joinMsg, setJoinMsg] = useState('');
  const [joinSuccess, setJoinSuccess] = useState(false);

  /** 내가 속한 그룹 + 그룹별 회의/문서/멤버 수 (MainPage.fetchGroups와 같은 방식) */
  const fetchGroups = async (uid: string) => {
    const { data } = await supabase
      .from('group_members')
      .select('group_id, groups(id, name, invite_code)')
      .eq('user_id', uid);
    const seen = new Set<string>();
    const list: Group[] = [];
    if (data) {
      for (const row of data as { groups: Group | Group[] | null }[]) {
        const raw = row.groups;
        const g = Array.isArray(raw) ? raw[0] : raw;
        if (!g?.id || seen.has(g.id)) continue;
        seen.add(g.id);
        list.push(g);
      }
    }
    setGroups(list);

    const ids = list.map((g) => g.id);
    if (ids.length === 0) { setStats({}); return; }

    const { data: meetingRows } = await supabase
      .from('meetings')
      .select('group_id, date, attachments')
      .in('group_id', ids);
    const { data: memberRows } = await supabase
      .from('group_members')
      .select('group_id, user_id')
      .in('group_id', ids);

    const next: Record<string, GroupStats> = {};
    for (const id of ids) next[id] = { meetingCount: 0, docCount: 0, memberCount: 0, lastActivity: 0 };
    for (const row of (meetingRows || []) as { group_id: string; date: string; attachments: unknown }[]) {
      const s = next[row.group_id];
      if (!s) continue;
      s.meetingCount += 1;
      s.docCount += Array.isArray(row.attachments) ? row.attachments.length : 0;
      // "최근 활동순" 정렬 기준 = 가장 최근 회의 저장 시각
      s.lastActivity = Math.max(s.lastActivity, new Date(row.date).getTime() || 0);
    }
    const seenMembers = new Set<string>();
    for (const row of (memberRows || []) as { group_id: string; user_id: string }[]) {
      const s = next[row.group_id];
      const key = `${row.group_id}:${row.user_id}`;
      if (!s || seenMembers.has(key)) continue;
      seenMembers.add(key);
      s.memberCount += 1;
    }
    setStats(next);
  };

  useEffect(() => {
    const init = async () => {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) { navigate('/'); return; }
      setUserId(userData.user.id);
      fetchGroups(userData.user.id);
    };
    init();
    // 처음 한 번만 불러오면 되므로 의존성은 비워둡니다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 정렬된 목록 — 최근 활동순은 회의가 없는 그룹이 맨 뒤로(원래 순서 유지) */
  const sortedGroups = useMemo(() => {
    const list = [...groups];
    if (sortKey === 'name') return list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return list.sort((a, b) => (stats[b.id]?.lastActivity ?? 0) - (stats[a.id]?.lastActivity ?? 0));
  }, [groups, stats, sortKey]);

  const toggleFavorite = (groupId: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      } catch {
        // 저장이 막힌 환경에서도 화면 상태는 그대로 동작하게 둡니다
      }
      return next;
    });
  };

  const createGroup = async () => {
    if (!groupName.trim()) return;
    const { data, error } = await supabase
      .from('groups')
      .insert({ name: groupName, invite_code: rndCode(), created_by: userId })
      .select().maybeSingle();
    if (error || !data) { alert(`생성 실패: ${error?.message}`); return; }

    const memberResult = await addGroupMember(data.id, userId);
    if (!memberResult.ok) {
      alert(`그룹은 만들어졌지만 멤버 등록 실패: ${memberResult.error}`);
      return;
    }
    setGroupName('');
    setModalOpen(false);
    fetchGroups(userId);
    navigate(`/group/${data.id}`, { state: GROUP_FROM_LIST });
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
    setTimeout(() => {
      setModalOpen(false);
      navigate(`/group/${result.group.id}`, { state: GROUP_FROM_LIST });
    }, 800);
  };

  return (
    <AppShell activePage="member">
      <div className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.label}>전체 그룹</h1>
          <p className={styles.headline}>함께하는 팀이 더 멀리 갑니다.</p>
          <p className={styles.subtitle}>그룹을 만들고, 더 효율적인 협업을 시작해보세요.</p>
        </header>

        {/* 전체 개수 배지(왼쪽) + 정렬 드롭다운(오른쪽) */}
        <div className={styles.toolbar}>
          <span className={styles.countPill}>
            <span>전체</span>
            <span>({groups.length})</span>
          </span>

          {/* 정렬 + 그룹 만들기 — 새 시안에서는 둘 다 툴바 줄 오른쪽에 나란히 놓입니다 */}
          <div className={styles.toolbarRight}>
            <div className={styles.sortWrap}>
              <button
                type="button"
                className={styles.sortButton}
                aria-haspopup="listbox"
                aria-expanded={sortOpen}
                onClick={() => setSortOpen((prev) => !prev)}
              >
                {SORT_LABELS[sortKey]}
                <Icon name="chevron-down" className={styles.sortChevron} />
              </button>
              {/* 정렬 메뉴 — 열려 있을 때만 렌더링, 항목을 고르면 닫힙니다 */}
              {sortOpen && (
                <ul className={styles.sortMenu} role="listbox">
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                    <li key={key}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={key === sortKey}
                        className={`${styles.sortOption}${key === sortKey ? ` ${styles.sortOptionActive}` : ''}`}
                        onClick={() => { setSortKey(key); setSortOpen(false); }}
                      >
                        {SORT_LABELS[key]}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button type="button" className={styles.createButton} onClick={() => setModalOpen(true)}>
              그룹 만들기
            </button>
          </div>
        </div>

        {/* 카드 목록 — 이 영역만 스크롤됩니다(피그마 Scrollbar - Vertical) */}
        <div className={styles.list}>
          {sortedGroups.length === 0 ? (
            <p className={styles.empty}>아직 참여 중인 그룹이 없어요. 그룹 만들기로 시작해보세요.</p>
          ) : (
            <div className={styles.grid}>
              {sortedGroups.map((g) => {
                const stat = stats[g.id] ?? { meetingCount: 0, docCount: 0, memberCount: 0, lastActivity: 0 };
                const visibleMembers = Math.min(3, stat.memberCount);
                const extraMembers = stat.memberCount - visibleMembers;
                const favorite = favorites.has(g.id);
                return (
                  <div
                    key={g.id}
                    className={styles.card}
                    onClick={() => navigate(`/group/${g.id}`, { state: GROUP_FROM_LIST })}
                  >
                    {/* 각 요소는 카드 SVG 좌표계의 %로 배치합니다(CSS 참고) */}
                    <div className={styles.badge}>{g.name.trim().charAt(0) || 'G'}</div>
                    <div className={styles.name}>{g.name}</div>
                    <div className={styles.invite}>초대코드 {g.invite_code}</div>
                    <div className={styles.members}>
                      {/* 실제 그룹원 프로필 이미지 — 아직 못 불러왔으면 기존 임시 아이콘으로 대신합니다 */}
                      {Array.from({ length: visibleMembers }).map((_, i) => {
                        const member = memberAvatars[g.id]?.[i];
                        return member ? (
                          <img key={member.user_id} src={getAvatarSrc(member.avatar)} alt="" />
                        ) : (
                          <Icon key={i} name="circle-user" />
                        );
                      })}
                      {extraMembers > 0 && <span className={styles.more}>+{extraMembers}</span>}
                    </div>
                    <div className={styles.stats}>
                      <span className={styles.stat}><Icon name="file-text" />회의 {stat.meetingCount}</span>
                      <span className={styles.stat}><Icon name="file-text" />문서 {stat.docCount}</span>
                    </div>

                    {/* 카드 전체가 클릭 이동이라, 즐겨찾기/더보기는 이벤트가 번지지 않게 막습니다 */}
                    <button
                      type="button"
                      className={`${styles.favoriteButton}${favorite ? ` ${styles.favoriteOn}` : ''}`}
                      aria-label={favorite ? '즐겨찾기 해제' : '즐겨찾기'}
                      aria-pressed={favorite}
                      onClick={(e) => { e.stopPropagation(); toggleFavorite(g.id); }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 3.2l2.67 5.66 6.2.74-4.58 4.24 1.2 6.13L12 17.1l-5.49 2.87 1.2-6.13L3.13 9.6l6.2-.74L12 3.2z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className={styles.moreButton}
                      aria-label="그룹 설정"
                      onClick={(e) => { e.stopPropagation(); navigate(`/group/${g.id}/settings`); }}
                    >
                      <img src={moreVerticalIcon} alt="" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <GroupModal
        open={modalOpen}
        groupName={groupName}
        inviteInput={inviteInput}
        joinMsg={joinMsg}
        joinSuccess={joinSuccess}
        onClose={() => setModalOpen(false)}
        onGroupNameChange={setGroupName}
        onInviteChange={setInviteInput}
        onCreate={createGroup}
        onJoin={joinGroup}
      />
    </AppShell>
  );
}
